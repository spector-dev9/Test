import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  authorizeGitHubCopilot,
  listConnectedProviders,
} from "../lib/opencode";
import {
  cloneRepository,
  commitAndPush,
  isGitHubToolsSupported,
  joinWorkspacePath,
  parseRepositoryUrl,
  repositoryStatus,
} from "../lib/github";

const COPILOT_ID = "github-copilot";
const POLL_INTERVAL_MS = 2500;
const MAX_POLL_ATTEMPTS = 120;

export function GitHubCard({
  directory,
  connected,
  workspaceDirectory,
  onSelectWorkspace,
  onProjectsChanged,
  onProvidersChanged,
}) {
  const native = isGitHubToolsSupported();
  const [providers, setProviders] = useState({
    status: "checking",
    connected: false,
    error: "",
  });
  const [auth, setAuth] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [repo, setRepo] = useState(null);
  const [repoBusy, setRepoBusy] = useState(true);
  const [repoError, setRepoError] = useState("");
  const [repoToken, setRepoToken] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [cloneBusy, setCloneBusy] = useState(false);
  const [cloneError, setCloneError] = useState("");
  const [clonedPath, setClonedPath] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [authorEmail, setAuthorEmail] = useState("");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState("");
  const [pushNotice, setPushNotice] = useState("");
  const pollTimer = useRef(null);
  const pollAttempts = useRef(0);
  const parsedRepository = useMemo(
    () => parseRepositoryUrl(repoUrl),
    [repoUrl],
  );
  const cloneBase = workspaceDirectory ?? directory;
  const destination = parsedRepository.ok && cloneBase
    ? joinWorkspacePath(cloneBase, parsedRepository.name)
    : "";
  const files = Array.isArray(repo?.files) ? repo.files : [];

  const stopPolling = useCallback(() => {
    if (pollTimer.current != null) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const refreshProviders = useCallback(async () => {
    if (!native || !connected || !directory) {
      setProviders({ status: "idle", connected: false, error: "" });
      return;
    }

    setProviders((current) => ({
      ...current,
      status: current.status === "idle" ? "checking" : "refreshing",
      error: "",
    }));

    try {
      const list = await listConnectedProviders(directory);
      setProviders({
        status: "ready",
        connected: list.includes(COPILOT_ID),
        error: "",
      });

      if (list.includes(COPILOT_ID)) {
        setAuth(null);
        stopPolling();
      }
    } catch (failure) {
      setProviders({
        status: "error",
        connected: false,
        error: failure?.message || "GitHub sign-in status is unavailable.",
      });
    }
  }, [connected, directory, native, stopPolling]);

  const refreshRepo = useCallback(async () => {
    if (!native || !directory) return;

    setRepoBusy(true);
    setRepoError("");

    try {
      setRepo(await repositoryStatus(directory));
    } catch (failure) {
      setRepo(null);
      setRepoError(failure?.message || "The repository status is unavailable.");
    } finally {
      setRepoBusy(false);
    }
  }, [directory, native]);

  useEffect(() => stopPolling, [stopPolling]);

  useEffect(() => {
    if (!native || !connected || !directory) return undefined;
    let cancelled = false;

    listConnectedProviders(directory)
      .then((list) => {
        if (cancelled) return;
        setProviders({
          status: "ready",
          connected: list.includes(COPILOT_ID),
          error: "",
        });

        if (list.includes(COPILOT_ID)) {
          setAuth(null);
          stopPolling();
        }
      })
      .catch((failure) => {
        if (cancelled) return;
        setProviders({
          status: "error",
          connected: false,
          error: failure?.message || "GitHub sign-in status is unavailable.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [connected, directory, native, stopPolling]);

  useEffect(() => {
    if (!native || !directory) return undefined;
    let cancelled = false;

    repositoryStatus(directory)
      .then((value) => {
        if (cancelled) return;
        setRepo(value);
        setRepoError("");
        setRepoBusy(false);
      })
      .catch((failure) => {
        if (cancelled) return;
        setRepo(null);
        setRepoError(
          failure?.message || "The repository status is unavailable.",
        );
        setRepoBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [directory, native]);

  async function startCopilot() {
    setAuthBusy(true);
    setAuthError("");

    try {
      const result = await authorizeGitHubCopilot(directory);
      setAuth(result);
      pollAttempts.current = 0;
      stopPolling();
      pollTimer.current = window.setInterval(async () => {
        pollAttempts.current += 1;

        if (pollAttempts.current > MAX_POLL_ATTEMPTS) {
          stopPolling();
          setAuthError("GitHub sign-in timed out. Start the sign-in again.");
          return;
        }

        try {
          const list = await listConnectedProviders(directory);

          if (list.includes(COPILOT_ID)) {
            stopPolling();
            setAuth(null);
            setProviders({ status: "ready", connected: true, error: "" });
            onProvidersChanged?.();
          }
        } catch {
          return;
        }
      }, POLL_INTERVAL_MS);
    } catch (failure) {
      setAuthError(failure?.message || "GitHub sign-in could not be started.");
    } finally {
      setAuthBusy(false);
    }
  }

  function cancelCopilot() {
    stopPolling();
    setAuth(null);
    setAuthError("");
  }

  async function clone() {
    if (!parsedRepository.ok) {
      setCloneError(parsedRepository.error);
      return;
    }

    setCloneBusy(true);
    setCloneError("");
    setPushNotice("");

    try {
      const result = await cloneRepository({
        url: parsedRepository.url,
        destination,
        token: repoToken.trim() || undefined,
        branch: branch.trim() || undefined,
      });
      const path = result?.path || destination;
      setClonedPath(path);
      setRepoUrl("");
      setBranch("");
      onProjectsChanged?.();
    } catch (failure) {
      setCloneError(failure?.message || "The repository could not be cloned.");
    } finally {
      setCloneBusy(false);
    }
  }

  async function push() {
    if (!repo?.isRepo) return;

    setPushBusy(true);
    setPushError("");
    setPushNotice("");

    try {
      const result = await commitAndPush({
        directory,
        message: commitMessage.trim(),
        token: repoToken.trim(),
        name: authorName.trim() || undefined,
        email: authorEmail.trim() || undefined,
      });
      setCommitMessage("");
      setPushNotice(
        result?.committed
          ? `Committed and pushed to ${result.branch}.`
          : `No changes to commit. Pushed ${result?.branch || "the current branch"}.`,
      );
      await refreshRepo();
      onProjectsChanged?.();
    } catch (failure) {
      setPushError(failure?.message || "The changes could not be pushed.");
    } finally {
      setPushBusy(false);
    }
  }

  const copilotTone = providers.connected
    ? "online"
    : providers.status === "error"
      ? "offline"
      : "loading";
  const copilotLabel = !native
    ? "Unavailable"
    : !connected
      ? "Server offline"
      : providers.status === "checking" || providers.status === "refreshing"
        ? "Checking"
        : providers.connected
          ? "Connected"
          : "Not signed in";

  return (
    <div className="panel settings-card">
      <div className="panel-heading">
        <div>
          <span className="panel-kicker">GITHUB</span>
          <h2>Models and repositories</h2>
        </div>
        <span className={`status-chip ${copilotTone}`}>
          <span className={`dot ${copilotTone}`} />
          {copilotLabel}
        </span>
      </div>

      <p className="panel-note">
        Sign in with GitHub Copilot to use Copilot models in OpenCode. Pushing
        uses a separate repository token with contents write access; the
        Copilot sign-in token cannot push code.
      </p>

      <div className="settings-runtime-actions">
        <button
          type="button"
          className="primary-button"
          onClick={startCopilot}
          disabled={!native || !connected || authBusy || Boolean(auth)}
        >
          {authBusy
            ? "Starting…"
            : providers.connected
              ? "Sign in again"
              : "Sign in with GitHub Copilot"}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={refreshProviders}
          disabled={!native || !connected || authBusy}
        >
          Recheck sign-in
        </button>
        {auth ? (
          <button type="button" className="secondary-button" onClick={cancelCopilot}>
            Cancel
          </button>
        ) : null}
      </div>

      {providers.error ? (
        <p className="panel-note" role="alert">
          {providers.error}
        </p>
      ) : null}

      {auth ? (
        <div className="github-auth">
          <p>
            <strong>{auth.instructions}</strong>
          </p>
          <a href={auth.url} rel="noreferrer">
            Open the GitHub device page
          </a>
          <p className="panel-note">
            Waiting for GitHub approval. This page updates automatically.
          </p>
        </div>
      ) : null}

      {authError ? (
        <p className="panel-note" role="alert">
          {authError}
        </p>
      ) : null}

      <div className="github-divider" />

      <div className="panel-heading">
        <div>
          <span className="panel-kicker">REPOSITORY</span>
          <h3>{repo?.isRepo ? repo.branch || "Detached HEAD" : "Clone a repository"}</h3>
        </div>
        <span
          className={`status-chip ${repo?.isRepo ? "online" : "offline"}`}
        >
          <span className={`dot ${repo?.isRepo ? "online" : "offline"}`} />
          {repoBusy ? "Checking" : repo?.isRepo ? "Git repository" : "Not a repository"}
        </span>
      </div>

      <dl className="detail-list">
        <DetailRow label="Directory">
          <code>{directory}</code>
        </DetailRow>
        {repo?.isRepo ? (
          <>
            <DetailRow label="Branch">{repo.branch || "Detached HEAD"}</DetailRow>
            <DetailRow label="Origin">
              <code>{repo.remote || "No origin remote"}</code>
            </DetailRow>
            <DetailRow label="Uncommitted files">
              {repo.changes ?? 0}
            </DetailRow>
          </>
        ) : null}
      </dl>

      {files.length > 0 ? (
        <ul className="github-files">
          {files.slice(0, 8).map((file) => (
            <li key={file}>
              <code>{file}</code>
            </li>
          ))}
        </ul>
      ) : null}

      {repoError ? (
        <p className="panel-note" role="alert">
          {repoError}
        </p>
      ) : null}

      {repo?.isRepo ? (
        <form
          className="github-form"
          onSubmit={(event) => {
            event.preventDefault();
            push();
          }}
        >
          <h3>Commit and push</h3>
          <label className="github-field">
            <span>Commit message</span>
            <textarea
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              placeholder={
                repo.changes > 0
                  ? "Describe the changes"
                  : "Optional when there is nothing to commit"
              }
              maxLength={500}
              rows={3}
            />
          </label>
          <div className="github-field-row">
            <label className="github-field">
              <span>Author name (optional)</span>
              <input
                value={authorName}
                onChange={(event) => setAuthorName(event.target.value)}
                placeholder="OpenCode Mobile"
                maxLength={80}
                autoComplete="name"
              />
            </label>
            <label className="github-field">
              <span>Author email (optional)</span>
              <input
                value={authorEmail}
                onChange={(event) => setAuthorEmail(event.target.value)}
                placeholder="you@example.com"
                maxLength={200}
                inputMode="email"
                autoComplete="email"
              />
            </label>
          </div>
          <label className="github-field">
            <span>Repository token</span>
            <input
              type="password"
              value={repoToken}
              onChange={(event) => setRepoToken(event.target.value)}
              placeholder="Fine-grained token with Contents: Read and write"
              maxLength={500}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <div className="settings-runtime-actions">
            <button
              type="submit"
              className="primary-button"
              disabled={
                pushBusy ||
                !repoToken.trim() ||
                (repo.changes > 0 && !commitMessage.trim())
              }
            >
              {pushBusy
                ? "Pushing…"
                : repo.changes > 0
                  ? "Commit and push"
                  : "Push current branch"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={refreshRepo}
              disabled={repoBusy}
            >
              {repoBusy ? "Checking…" : "Refresh status"}
            </button>
          </div>
          {pushError ? (
            <p className="panel-note" role="alert">
              {pushError}
            </p>
          ) : null}
          {pushNotice ? <p className="panel-note">{pushNotice}</p> : null}
        </form>
      ) : (
        <form
          className="github-form"
          onSubmit={(event) => {
            event.preventDefault();
            clone();
          }}
        >
          <h3>Clone with HTTPS</h3>
          <label className="github-field">
            <span>Repository URL</span>
            <input
              value={repoUrl}
              onChange={(event) => setRepoUrl(event.target.value)}
              placeholder="https://github.com/owner/repository"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <div className="github-field-row">
            <label className="github-field">
              <span>Branch (optional)</span>
              <input
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                placeholder="main"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </label>
            <label className="github-field">
              <span>Repository token (optional)</span>
              <input
                type="password"
                value={repoToken}
                onChange={(event) => setRepoToken(event.target.value)}
                placeholder="For private repositories"
                maxLength={500}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          </div>
          <p className="panel-note">
            Destination: <code>{destination || "Enter a repository URL"}</code>
          </p>
          <div className="settings-runtime-actions">
            <button
              type="submit"
              className="primary-button"
              disabled={cloneBusy || !parsedRepository.ok || !destination}
            >
              {cloneBusy ? "Cloning…" : "Clone repository"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={refreshRepo}
              disabled={repoBusy}
            >
              Refresh status
            </button>
          </div>
          {repoUrl && !parsedRepository.ok ? (
            <p className="panel-note" role="alert">
              {parsedRepository.error}
            </p>
          ) : null}
          {cloneError ? (
            <p className="panel-note" role="alert">
              {cloneError}
            </p>
          ) : null}
          {clonedPath ? (
            <div className="github-cloned">
              <p>
                Cloned to <code>{clonedPath}</code>
              </p>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  const result = onSelectWorkspace(clonedPath);

                  if (!result?.ok) {
                    setCloneError(
                      result?.error || "The cloned folder could not be opened.",
                    );
                  }
                }}
              >
                Use cloned folder as workspace
              </button>
            </div>
          ) : null}
        </form>
      )}

      <p className="panel-note">
        Tokens stay in memory on this screen and are never stored by the app.
        Use a fine-grained GitHub token with repository contents write access.
      </p>
    </div>
  );
}

function DetailRow({ label, children }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
