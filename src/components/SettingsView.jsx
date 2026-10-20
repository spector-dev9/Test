import { Capacitor } from "@capacitor/core";
import { BROWSER_REQUEST_TIMEOUT_MS } from "../lib/connection";
import { MAX_RESPONSE_BYTES } from "../lib/nativeFetch";
import {
  MAX_COMPOSER_CHARS,
  OPENCODE_BASE_URL,
} from "../lib/opencode";
import {
  projectLabel,
  projectPathLabel,
} from "../lib/project";
import {
  describeServer,
  offlineLabel,
} from "../lib/workspace";

function DetailRow({ label, children }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function SettingsView({
  health,
  connection,
  connected,
  onRefresh,
  canRefresh,
  project,
  projects,
}) {
  const native = Capacitor.isNativePlatform();
  const statusLabel = connected
    ? "Connected"
    : connection.tone === "offline"
      ? offlineLabel(health.errorKind)
      : "Checking";

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
              <code>http://127.0.0.1:4096</code>
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

      <div className="panel settings-card diagnostics-card">
        <span className="panel-kicker">DIAGNOSTICS</span>
        <h2>What this app can access</h2>
        <ul className="settings-list">
          <li>Health, project discovery, and scoped session lists</li>
          <li>Session messages, prompts, commands, and abort requests</li>
          <li>Rename, archive, restore, and permanent session deletion</li>
          <li>Pending permission requests and explicit replies</li>
          <li>Configured models, project commands, and VCS data</li>
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
