import { OPENCODE_BASE_URL, PROJECT_DIRECTORY } from "../lib/opencode";
import {
  describeServer,
  offlineLabel,
} from "../lib/workspace";
import { SessionList } from "./SessionList";

const NAVIGATION = [
  { id: "chat", label: "Chat", icon: "⌘" },
  { id: "sessions", label: "Sessions", icon: "▤" },
  { id: "models", label: "Models", icon: "⌁" },
  { id: "changes", label: "Changes", icon: "◫" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

export function SidebarContent({
  health,
  sessions,
  canRefresh,
  connection,
  onRefresh,
  onClose,
  activeView,
  onNavigate,
  selectedSessionId,
  onSelectSession,
  onNewSession,
  creatingSession,
  createError,
  connected,
  sessionActionsDisabled,
}) {
  const sessionCount = sessions.data.length;

  return (
    <>
      {onClose ? (
        <div className="drawer-head">
          <span>WORKSPACE</span>
          <button
            type="button"
            className="icon-button drawer-close"
            onClick={onClose}
            aria-label="Close workspace menu"
            autoFocus
          >
            ×
          </button>
        </div>
      ) : null}

      <button
        className="new-chat"
        type="button"
        onClick={onNewSession}
        disabled={!connected || creatingSession || sessionActionsDisabled}
        title={
          !connected
            ? "Connect to OpenCode before creating a session"
            : sessionActionsDisabled
              ? "Wait for the current response to finish"
              : "Create a new session"
        }
      >
        <span>＋ {creatingSession ? "Creating session…" : "New session"}</span>
        <span className="create-badge">
          {creatingSession ? "…" : "CREATE"}
        </span>
      </button>

      {createError ? (
        <div className="inline-error" role="alert">
          <span>{createError.message}</span>
        </div>
      ) : null}

      <p className="section-label">WORKSPACE</p>
      <nav className="workspace-nav" aria-label="Workspace views">
        {NAVIGATION.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-item${activeView === item.id ? " active" : ""}`}
            aria-current={activeView === item.id ? "page" : undefined}
            onClick={() => onNavigate(item.id)}
          >
            <span>
              {item.icon} {item.label}
            </span>
            {item.id === "sessions" ? (
              <span className="nav-count">
                {sessions.status === "ready" ? sessionCount : "—"}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="sessions-header">
        <p className="section-label">PROJECT SESSIONS</p>
        <span className="live-badge">LIVE</span>
      </div>

      <SessionList
        sessions={sessions}
        canRetry={canRefresh}
        onRetry={onRefresh}
        selectedSessionId={selectedSessionId}
        onSelectSession={onSelectSession}
        disabled={sessionActionsDisabled}
      />

      <div className="sidebar-bottom">
        <div className="connection-line">
          <span className={`dot ${connection.tone}`} />
          <span>
            {connected
              ? `OpenCode v${health.data.version}`
              : connection.tone === "offline"
                ? `OpenCode ${offlineLabel(health.errorKind).toLowerCase()}`
                : "Connecting to OpenCode"}
          </span>
        </div>
        <small>{describeServer(OPENCODE_BASE_URL)}</small>
        <small className="scope-note" title={PROJECT_DIRECTORY}>
          This project only
        </small>
      </div>
    </>
  );
}
