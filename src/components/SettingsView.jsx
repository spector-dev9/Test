import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { BROWSER_REQUEST_TIMEOUT_MS } from "../lib/connection";
import { localServerLogs } from "../lib/localServer";
import { MAX_RESPONSE_BYTES } from "../lib/nativeFetch";
import {
  MAX_COMPOSER_CHARS,
  OPENCODE_BASE_URL,
} from "../lib/opencode";
import {
  PROJECT_DIRECTORY,
  projectLabel,
  projectPathLabel,
} from "../lib/project";
import {
  isStorageSupported,
  pickWorkspaceDirectory,
  requestStorageAccess,
  storageStatus,
} from "../lib/storage";
import {
  describeServer,
  offlineLabel,
} from "../lib/workspace";
import { GitHubCard } from "./GitHubCard";

function DetailRow({ label, children }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function runtimeConnection(status, connected) {
  if (status?.state === "error") {
    return { tone: "offline", label: "Runtime error" };
  }
  if (["preparing", "downloading", "extracting", "starting"].includes(status?.state)) {
    return { tone: "loading", label: "Starting" };
  }
  if (status?.state === "running") {
    return {
      tone: connected ? "online" : "loading",
      label: connected ? "Running" : "Waiting",
    };
  }
  if (status?.state === "stopped") {
    return { tone: "offline", label: "Stopped" };
  }
  if (status?.state === "unavailable" || !status) {
    return { tone: "offline", label: "Not supported" };
  }
  return { tone: "loading", label: "Preparing" };
}

export function SettingsView({
  health,
  connection,
  connected,
  onRefresh,
  canRefresh,
  project,
  projects,
  localServer,
  workspaceDirectory,
  onSelectWorkspace,
  onProjectsChanged,
  onProvidersChanged,
}) {
  const native = Capacitor.isNativePlatform();
  const storageSupported = isStorageSupported();
  const statusLabel = connected
    ? "Connected"
    : connection.tone === "offline"
      ? offlineLabel(health.errorKind)
      : "Checking";
  const runtime = localServer ?? null;
  const runtimeState = runtimeConnection(runtime, connected);
  const runtimeBusy =
    Boolean(runtime) &&
    ["preparing", "downloading", "extracting", "starting"].includes(
      runtime.state,
    );
  const [logs, setLogs] = useState("");
  const [logsBusy, setLogsBusy] = useState(false);
  const [storage, setStorage] = useState(null);
  const [storageBusy, setStorageBusy] = useState(false);
  const [storageError, setStorageError] = useState("");

  useEffect(() => {
    if (!storageSupported) return undefined;
    let cancelled = false;

    storageStatus()
      .then((value) => {
        if (!cancelled) setStorage(value);
      })
      .catch((failure) => {
        if (!cancelled) {
          setStorageError(failure?.message || "Storage status is unavailable.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [storageSupported]);

  async function allowStorage() {
    setStorageBusy(true);
    setStorageError("");

    try {
      const value = await requestStorageAccess();
      setStorage(value ?? (await storageStatus()));
    } catch (failure) {
      setStorageError(failure?.message || "Storage access could not be requested.");
    } finally {
      setStorageBusy(false);
    }
  }

  async function chooseWorkspace() {
    setStorageBusy(true);
    setStorageError("");

    try {
      const selection = await pickWorkspaceDirectory();
      if (!selection) return;

      const result = onSelectWorkspace(selection.path);
      if (!result?.ok) {
        setStorageError(result?.error || "The folder could not be selected.");
        return;
      }

      const value = await storageStatus().catch(() => null);
      if (value) setStorage(value);

      if (value && !value.allFiles) {
        setStorageError(
          "Folder selected. Grant all-files access so the OpenCode runtime and terminal can read it.",
        );
      }
    } catch (failure) {
      setStorageError(failure?.message || "The folder picker could not be opened.");
    } finally {
      setStorageBusy(false);
    }
  }

  async function showLogs() {
    if (logs) {
      setLogs("");
      return;
    }
    setLogsBusy(true);
    try {
      setLogs((await localServerLogs()) || "No server output yet.");
    } catch (failure) {
      setLogs(failure?.message || "Server logs are unavailable.");
    } finally {
      setLogsBusy(false);
    }
  }

  function repairRuntime() {
    if (!runtime) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Remove the downloaded runtime and download it again? Your workspace and sessions stay on this device.",
      )
    ) {
      return;
    }
    runtime.repair();
  }

  return (
    <section className="page-view" aria-labelledby="settings-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow">WORKSPACE</p>
          <h1 id="settings-heading">Settings</h1>
          <p className="subtitle">
            Connection details and diagnostics. No credentials are stored in
            this app.
          </p>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={onRefresh}
          disabled={!canRefresh}
        >
          Test connection
        </button>
      </div>

      <div className="settings-grid">
        <section className="panel settings-card">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">OPENCODE SERVER</span>
              <h2>{describeServer(OPENCODE_BASE_URL)}</h2>
            </div>
            <span className={`status-chip ${connection.tone}`}>
              <span className={`dot ${connection.tone}`} />
              {statusLabel}
            </span>
          </div>

          <dl className="detail-list">
            <DetailRow label="Server URL">
              <code>{OPENCODE_BASE_URL}</code>
            </DetailRow>
            <DetailRow label="Server version">
              {connected ? `v${health.data.version}` : "Unavailable"}
            </DetailRow>
            <DetailRow label="Active project">
              {project ? projectLabel(project) : "Unavailable"}
            </DetailRow>
            <DetailRow label="Project directory">
              <code>
                {project
                  ? projectPathLabel(project)
                  : "No project selected"}
              </code>
            </DetailRow>
            <DetailRow label="Discovered projects">
              {projects?.status === "ready"
                ? projects.data.length
                : "Unavailable"}
            </DetailRow>
            <DetailRow label="Transport">
              {native ? "Native Capacitor HTTP" : "Browser fetch"}
            </DetailRow>
          </dl>

          {health.error ? (
            <p className="panel-note">{health.error}</p>
          ) : null}
        </section>

        <section className="panel settings-card">
          <span className="panel-kicker">REQUEST SAFETY</span>
          <h2>Mobile connection policy</h2>
          <dl className="detail-list">
            <DetailRow label="Native origin">
              <code>{OPENCODE_BASE_URL}</code>
            </DetailRow>
            <DetailRow label="Native timeouts">
              10s connect · 30s read
            </DetailRow>
            <DetailRow label="Browser timeout">
              {BROWSER_REQUEST_TIMEOUT_MS / 1000}s
            </DetailRow>
            <DetailRow label="Response limit">
              {Math.round(MAX_RESPONSE_BYTES / (1024 * 1024))} MiB
            </DetailRow>
            <DetailRow label="Prompt limit">
              {MAX_COMPOSER_CHARS.toLocaleString()} characters
            </DetailRow>
          </dl>
          <p className="panel-note">
            The server URL is compiled into this build. Native builds only
            accept the exact loopback origin above. Changing it requires a
            deliberate source and native-policy change followed by a rebuild.
          </p>
        </section>
      </div>

      {native ? (
        <div className="panel settings-card">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">DEVICE STORAGE</span>
              <h2>Workspace folders</h2>
            </div>
            <span
              className={`status-chip ${storage?.allFiles ? "online" : "offline"}`}
            >
              <span
                className={`dot ${storage?.allFiles ? "online" : "offline"}`}
              />
              {storage
                ? storage.allFiles
                  ? "Allowed"
                  : "Not allowed"
                : storageSupported
                  ? "Checking"
                  : "Unsupported"}
            </span>
          </div>

          <dl className="detail-list">
            <DetailRow label="All files access">
              {storage
                ? storage.allFiles
                  ? `Allowed (Android API ${storage.sdk})`
                  : `Not allowed (Android API ${storage.sdk})`
                : storageSupported
                  ? "Checking…"
                  : "Unavailable in this build"}
            </DetailRow>
            <DetailRow label="Active workspace">
              <code>{workspaceDirectory ?? PROJECT_DIRECTORY}</code>
            </DetailRow>
          </dl>

          <div className="settings-runtime-actions">
            {!storage?.allFiles ? (
              <button
                type="button"
                className="primary-button"
                onClick={allowStorage}
                disabled={storageBusy || !storageSupported}
              >
                Allow all files access
              </button>
            ) : null}
            <button
              type="button"
              className="secondary-button"
              onClick={chooseWorkspace}
              disabled={storageBusy || !storageSupported}
            >
              {storageBusy ? "Opening…" : "Choose folder"}
            </button>
            {workspaceDirectory ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => onSelectWorkspace(PROJECT_DIRECTORY)}
                disabled={storageBusy}
              >
                Use app workspace
              </button>
            ) : null}
          </div>

          {storageError ? (
            <p className="panel-note" role="alert">
              {storageError}
            </p>
          ) : null}

          <p className="panel-note">
            All-files access lets the OpenCode runtime and terminal read folders
            outside the app sandbox. The folder picker supports internal storage
            and SD card paths; cloud providers without filesystem paths cannot
            be used as a workspace.
          </p>
        </div>
      ) : null}

      {native && project ? (
        <GitHubCard
          key={project.worktree}
          directory={project.worktree}
          connected={connected}
          workspaceDirectory={workspaceDirectory}
          onSelectWorkspace={onSelectWorkspace}
          onProjectsChanged={onProjectsChanged}
          onProvidersChanged={onProvidersChanged}
        />
      ) : null}

      {native ? (
        <div className="panel settings-card">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">LOCAL RUNTIME</span>
              <h2>OpenCode on this device</h2>
            </div>
            <span className={`status-chip ${runtimeState.tone}`}>
              <span className={`dot ${runtimeState.tone}`} />
              {runtimeState.label}
            </span>
          </div>

          <dl className="detail-list">
            <DetailRow label="Status">
              {runtime?.message || "No local runtime has started yet."}
            </DetailRow>
            <DetailRow label="Runtime version">
              {runtime?.version ? `v${runtime.version}` : "Not installed"}
            </DetailRow>
            <DetailRow label="Server URL">
              <code>{OPENCODE_BASE_URL}</code>
            </DetailRow>
            <DetailRow label="Workspace">
              <code>
                {runtime?.workspace || projectPathLabel(project)}
              </code>
            </DetailRow>
          </dl>

          {runtimeBusy ? (
            <div
              className="settings-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={runtime.progress}
              aria-label="Runtime setup progress"
            >
              <span style={{ width: `${Math.max(2, runtime.progress)}%` }} />
            </div>
          ) : null}

          {runtime?.error ? (
            <p className="panel-note">{runtime.error}</p>
          ) : null}

          <div className="settings-runtime-actions">
            {runtime?.state === "running" ? (
              <button
                type="button"
                className="secondary-button"
                onClick={runtime.stop}
              >
                Stop server
              </button>
            ) : (
              <button
                type="button"
                className="primary-button"
                onClick={runtime?.retry}
                disabled={runtimeBusy || !runtime}
              >
                {runtime?.state === "error" ? "Try again" : "Start runtime"}
              </button>
            )}
            <button
              type="button"
              className="secondary-button"
              onClick={runtime?.restart}
              disabled={runtimeBusy || !runtime}
            >
              Restart
            </button>
            <button
              type="button"
              className="danger-button"
              onClick={repairRuntime}
              disabled={runtimeBusy || !runtime}
            >
              Repair runtime
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={showLogs}
              disabled={logsBusy || !runtime}
            >
              {logs ? "Hide logs" : logsBusy ? "Reading…" : "Server logs"}
            </button>
          </div>

          {logs ? <pre className="settings-log">{logs}</pre> : null}

          <p className="panel-note">
            The runtime and workspace live in app-private storage. Provider
            credentials are only stored in that local runtime; this app does
            not read credentials from outside its sandbox.
          </p>
        </div>
      ) : null}

      <div className="panel settings-card diagnostics-card">
        <span className="panel-kicker">DIAGNOSTICS</span>
        <h2>What this app can access</h2>
        <ul className="settings-list">
          <li>Health, project discovery, and scoped session lists</li>
          <li>Session messages, prompts, commands, and abort requests</li>
          <li>Rename, archive, restore, and permanent session deletion</li>
          <li>Pending permission requests and explicit replies</li>
          <li>Configured models, project commands, and VCS data</li>
          <li>GitHub Copilot sign-in and HTTPS repository clone and push</li>
        </ul>
        <p className="panel-note">
          The app does not read your OpenCode credentials, bypass provider
          policy, or automatically approve agent actions. Permission prompts
          require an explicit response. Conversations refresh by polling
          because the native HTTP bridge does not expose server-sent events.
        </p>
      </div>
    </section>
  );
}
