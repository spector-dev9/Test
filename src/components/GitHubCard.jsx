import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CONNECTION_ERROR_KINDS } from "../lib/connection";
import { DetailRow } from "./DetailRow";
import {
  authorizeGitHubCopilot,
  completeGitHubCopilot,
} from "../lib/opencode";
import {
  checkoutBranch,
  cloneRepository,
  commitAndPush,
  copilotStatus,
  fetchRepository,
  initRepository,
  isGitHubToolsSupported,
  joinWorkspacePath,
  listBranches,
  parseRemoteUrl,
  parseRepositoryUrl,
  pullRepository,
  repositoryStatus,
} from "../lib/github";

const POLL_INTERVAL_MS = 2500;
const MAX_POLL_ATTEMPTS = 360;
const RETRYABLE_AUTH_KINDS = new Set([
  CONNECTION_ERROR_KINDS.NETWORK,
  CONNECTION_ERROR_KINDS.TIMEOUT,
  CONNECTION_ERROR_KINDS.UNKNOWN,
]);

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
  const [syncBusy, setSyncBusy] = useState("");
  const [syncError, setSyncError] = useState("");
  const [syncNotice, setSyncNotice] = useState("");
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [initBranch, setInitBranch] = useState("main");
  const [initRemote, setInitRemote] = useState("");
  const pollTimer = useRef(null);
  const pollAttempts = useRef(0);
  const authController = useRef(null);
  const authGeneration = useRef(0);
  const mountedRef = useRef(true);
  const parsedRepository = useMemo(
    () => parseRepositoryUrl(repoUrl),
    [repoUrl],
  );
  const parsedInitRemote = useMemo(
    () => (initRemote.trim() ? parseRemoteUrl(initRemote) : { ok: true, url: "" }),
    [initRemote],
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

  const stopAuthAttempt = useCallback(() => {
    authGeneration.current += 1;
    authController.current?.abort();
    authController.current = null;
    stopPolling();
  }, [stopPolling]);

  const finishCopilot = useCallback(() => {
    stopAuthAttempt();
    setAuth(null);
    setAuthBusy(false);
    setAuthError("");
    setProviders({ status: "ready", connected: true, error: "" });
    onProvidersChanged?.();
  }, [onProvidersChanged, stopAuthAttempt]);

  const refreshProviders = useCallback(async () => {
    if (!native) {
      setProviders({ status: "idle", connected: false, error: "" });
      return;
    }

    setProviders((current) => ({
      ...current,
      status: current.status === "idle" ? "checking" : "refreshing",
      error: "",
    }));

    try {
      const status = await copilotStatus();
      const signedIn = Boolean(status?.connected);

      setProviders({
        status: "ready",
        connected: signedIn,
        error: "",
      });

      if (signedIn) {
        stopAuthAttempt();
        setAuth(null);
        setAuthBusy(false);
      }
    } catch (failure) {
      setProviders((current) => ({
        status: "error",
        connected: current.connected,
        error: failure?.message || "GitHub sign-in status is unavailable.",
      }));
    }
  }, [native, stopAuthAttempt]);

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

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      stopAuthAttempt();
    };
  }, [stopAuthAttempt]);

  useEffect(() => {
    if (!native) {
      setProviders({ status: "idle", connected: false, error: "" });
      return undefined;
    }

    if (authBusy || auth) return undefined;

    refreshProviders();

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        refreshProviders();
      }
    }

    const timer = window.setInterval(refreshProviders, 60 * 1000);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [auth, authBusy, native, refreshProviders]);

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

  useEffect(() => {
    if (!native || !directory || !repo?.isRepo) {
      setBranches([]);
      return undefined;
    }

    let cancelled = false;

    listBranches(directory)
      .then((value) => {
        if (cancelled) return;
        const names = Array.isArray(value?.branches) ? value.branches : [];
        setBranches(names);
        setSelectedBranch((current) =>
          names.includes(current) ? current : value?.current || "",
        );
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      });

    return () => {
      cancelled = true;
    };
  }, [directory, native, repo?.isRepo, repo?.branch]);

  async function syncRepository(action) {
    if (syncBusy) return;

    setSyncBusy(action);
    setSyncError("");
    setSyncNotice("");

    try {
      const token = repoToken.trim() || undefined;
      const result =
        action === "fetch"
          ? await fetchRepository({ directory, token })
          : await pullRepository({ directory, token });

      setSyncNotice(
        action === "fetch"
          ? `Fetched from ${result?.remote || "origin"}.`
          : `Pulled ${result?.branch || "the current branch"}.`,
      );
      await refreshRepo();
      onProjectsChanged?.();
    } catch (failure) {
      setSyncError(failure?.message || "The repository could not be synced.");
    } finally {
      setSyncBusy("");
    }
  }

  async function switchBranch() {
    const target = selectedBranch.trim();

    if (!target || target === repo?.branch || syncBusy) return;

    setSyncBusy("checkout");
    setSyncError("");
    setSyncNotice("");

    try {
      const result = await checkoutBranch({ directory, branch: target });
      setSyncNotice(`Switched to ${result?.branch || target}.`);
      await refreshRepo();
      onProjectsChanged?.();
    } catch (failure) {
      setSyncError(failure?.message || "The branch could not be switched.");
    } finally {
      setSyncBusy("");
    }
  }

  async function initializeRepository() {
    if (syncBusy) return;

    setSyncBusy("init");
    setSyncError("");
    setSyncNotice("");

    try {
      const result = await initRepository({
        directory,
        branch: initBranch.trim() || "main",
        remote: parsedInitRemote.ok && parsedInitRemote.url
          ? parsedInitRemote.url
          : undefined,
      });
      setSyncNotice(
        `Initialized a Git repository on ${result?.branch || initBranch.trim() || "main"}.`,
      );
      await refreshRepo();
    } catch (failure) {
      setSyncError(
        failure?.message || "The folder could not be turned into a repository.",
      );
    } finally {
      setSyncBusy("");
    }
  }

  async function startCopilot() {
    stopAuthAttempt();
    setAuthBusy(true);
    setAuthError("");
    setAuth(null);

    const generation = authGeneration.current;
    const controller = new AbortController();
    authController.current = controller;

    try {
      const result = await authorizeGitHubCopilot(
        directory,
        controller.signal,
      );

      if (!mountedRef.current || generation !== authGeneration.current) {
        return;
      }

      setAuth(result);
      pollAttempts.current = 0;
      pollTimer.current = window.setInterval(async () => {
        pollAttempts.current += 1;

        if (pollAttempts.current > MAX_POLL_ATTEMPTS) {
          stopAuthAttempt();
          setAuth(null);
          setAuthError("GitHub sign-in timed out. Start the sign-in again.");
          return;
        }

        try {
          const status = await copilotStatus();

          if (
            !mountedRef.current ||
            generation !== authGeneration.current
          ) {
            return;
          }

          if (status?.connected) {
            finishCopilot();
          }
        } catch {
          return;
        }
      }, POLL_INTERVAL_MS);

      completeGitHubCopilot(directory, controller.signal)
        .then(() => {
          if (
            !mountedRef.current ||
            generation !== authGeneration.current
          ) {
            return;
          }

          finishCopilot();
        })
        .catch((failure) => {
          if (
            !mountedRef.current ||
            generation !== authGeneration.current
          ) {
            return;
          }

          if (
            failure?.kind === CONNECTION_ERROR_KINDS.ABORTED ||
            RETRYABLE_AUTH_KINDS.has(failure?.kind)
          ) {
            return;
          }

          stopAuthAttempt();
          setAuth(null);
          setAuthError(
            failure?.message || "GitHub sign-in could not be completed.",
          );
        });
    } catch (failure) {
      if (!mountedRef.current || generation !== authGeneration.current) {
        return;
      }

      stopAuthAttempt();
      setAuthBusy(false);
      setAuthError(failure?.message || "GitHub sign-in could not be started.");
    } finally {
      if (mountedRef.current && generation === authGeneration.current) {
        setAuthBusy(false);
      }
    }
  }

  function cancelCopilot() {
    stopAuthAttempt();
    setAuth(null);
    setAuthBusy(false);
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
          ? "Signed in"
          : "Not signed in";

  return (
    <div className="panel settings-card">
      <div className="panel-heading">
        <div>
          <span className="panel-kicker">GITHUB COPILOT</span>
          <h2>Copilot models</h2>
        </div>
        <span className={`status-chip ${copilotTone}`}>
          <span className={`dot ${copilotTone}`} />
          {copilotLabel}
        </span>
      </div>

      <p className="panel-note">
        This sign-in only unlocks Copilot models inside OpenCode. It does not
        grant access to repositories: cloning, fetching, and pushing below use
        a separate repository token, and the Copilot token cannot read or
        write code.
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
            Waiting for GitHub approval. Keep this screen open; the app will
            update automatically.
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
          <span className="panel-kicker">REPOSITORY ACCESS</span>
          <h3>{repo?.isRepo ? repo.branch || "Detached HEAD" : "No repository here"}</h3>
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
        <>
          <div className="github-sync">
            <div className="settings-runtime-actions">
              <button
                type="button"
                className="secondary-button compact-button"
                onClick={() => syncRepository("fetch")}
                disabled={Boolean(syncBusy) || !repo?.remote}
                title={
                  repo?.remote
                    ? "Fetch the latest refs from origin"
                    : "This repository has no origin remote"
                }
              >
                {syncBusy === "fetch" ? "Fetching…" : "Fetch"}
              </button>
              <button
                type="button"
                className="secondary-button compact-button"
                onClick={() => syncRepository("pull")}
                disabled={Boolean(syncBusy) || !repo?.remote}
                title={
                  repo?.remote
                    ? "Fast-forward this branch from origin"
                    : "This repository has no origin remote"
                }
              >
                {syncBusy === "pull" ? "Pulling…" : "Pull"}
              </button>
              <button
                type="button"
                className="secondary-button compact-button"
                onClick={refreshRepo}
                disabled={repoBusy}
              >
                {repoBusy ? "Checking…" : "Refresh status"}
              </button>
            </div>

            {branches.length > 0 ? (
              <div className="github-branch-row">
                <label className="github-field">
                  <span>Branch</span>
                  <select
                    value={selectedBranch}
                    onChange={(event) => setSelectedBranch(event.target.value)}
                  >
                    {branches.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="secondary-button compact-button"
                  onClick={switchBranch}
                  disabled={
                    Boolean(syncBusy) ||
                    !selectedBranch ||
                    selectedBranch === repo?.branch
                  }
                >
                  {syncBusy === "checkout" ? "Switching…" : "Switch"}
                </button>
              </div>
            ) : null}

            {syncError ? (
              <p className="panel-note" role="alert">
                {syncError}
              </p>
            ) : null}
            {syncNotice ? (
              <p className="panel-note" role="status">
                {syncNotice}
              </p>
            ) : null}
          </div>
        </>
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
        <>
          <form
            className="github-form"
            onSubmit={(event) => {
              event.preventDefault();
              initializeRepository();
            }}
          >
            <h3>Start a repository here</h3>
            <p className="panel-note">
              The workspace folder is not a Git repository yet. Initialize one
              to track changes, then add a remote to push or pull.
            </p>
            <div className="github-field-row">
              <label className="github-field">
                <span>First branch</span>
                <input
                  value={initBranch}
                  onChange={(event) => setInitBranch(event.target.value)}
                  placeholder="main"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="github-field">
                <span>Remote (optional)</span>
                <input
                  value={initRemote}
                  onChange={(event) => setInitRemote(event.target.value)}
                  placeholder="https://github.com/owner/repository"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
            </div>
            {initRemote.trim() && !parsedInitRemote.ok ? (
              <p className="panel-note" role="alert">
                {parsedInitRemote.error}
              </p>
            ) : null}
            <div className="settings-runtime-actions">
              <button
                type="submit"
                className="primary-button"
                disabled={
                  syncBusy === "init" ||
                  !parsedInitRemote.ok ||
                  !initBranch.trim()
                }
              >
                {syncBusy === "init" ? "Initializing…" : "Initialize repository"}
              </button>
            </div>
            {syncError ? (
              <p className="panel-note" role="alert">
                {syncError}
              </p>
            ) : null}
            {syncNotice ? (
              <p className="panel-note" role="status">
                {syncNotice}
              </p>
            ) : null}
          </form>

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
        </>
      )}

      <p className="panel-note">
        Tokens stay in memory on this screen and are never stored by the app.
        Use a fine-grained GitHub token with repository contents write access.
      </p>
    </div>
  );
}
