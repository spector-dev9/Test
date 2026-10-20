import { useEffect, useRef, useState } from "react";
import "./App.css";
import { OPENCODE_BASE_URL, PROJECT_DIRECTORY } from "./lib/opencode";
import { useOpenCodeOverview } from "./hooks/useOpenCodeOverview";

const relativeTime = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});
const calendarDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

function describeServer(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return `${url.hostname}${url.port ? `:${url.port}` : ""}`;
  } catch {
    return baseUrl;
  }
}

function offlineTitle(kind) {
  switch (kind) {
    case "network":
      return "Cannot reach the OpenCode server";
    case "timeout":
      return "OpenCode did not respond";
    case "http":
      return "OpenCode returned an error";
    case "unhealthy":
      return "OpenCode reports an unhealthy state";
    case "configuration":
      return "OpenCode connection needs configuration";
    case "invalid":
      return "OpenCode returned an unexpected response";
    default:
      return "OpenCode is unavailable";
  }
}

function offlineLabel(kind) {
  switch (kind) {
    case "network":
      return "Offline";
    case "timeout":
      return "Timed out";
    case "unhealthy":
      return "Unhealthy";
    case "configuration":
      return "Config error";
    case "http":
    case "invalid":
      return "Error";
    default:
      return "Unavailable";
  }
}

function offlineHelp(kind) {
  switch (kind) {
    case "network":
      return "The app could not reach the local server. Start it and retry.";
    case "timeout":
      return "The server did not answer in time. Check that it is running, then retry.";
    case "http":
      return "The server responded, but the request failed. Check the server, then retry.";
    case "unhealthy":
      return "The server is reachable but reports an unhealthy state. Check the server, then retry.";
    case "configuration":
      return "This build's API URL conflicts with the native transport. Rebuild with the default loopback URL.";
    case "invalid":
      return "The server responded unexpectedly. Check its version, then retry.";
    default:
      return "Check the local OpenCode server and retry.";
  }
}

function formatSessionTime(timestamp) {
  if (!Number.isFinite(timestamp)) return "Unknown time";

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Unknown time";

  const difference = timestamp - Date.now();
  const minutes = Math.round(difference / 60000);

  if (Math.abs(minutes) < 60) {
    return relativeTime.format(minutes, "minute");
  }

  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return relativeTime.format(hours, "hour");
  }

  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) {
    return relativeTime.format(days, "day");
  }

  return calendarDate.format(date);
}

function SessionList({
  sessions,
  canRetry,
  onRetry,
  selectedSessionId,
  onSelectSession,
}) {
  const { status, data, error } = sessions;
  const hasSessions = data.length > 0;

  return (
    <div className="session-block" aria-busy={status === "loading" || status === "refreshing"}>
      {status === "loading" && !hasSessions ? (
        <div className="session-skeletons" aria-hidden="true">
          <span className="session-skeleton" />
          <span className="session-skeleton" />
          <span className="session-skeleton" />
        </div>
      ) : null}

      {status === "error" ? (
        <div className="inline-error" role="alert">
          <span>{error || "Sessions could not be loaded."}</span>
          <button
            type="button"
            className="text-button"
            onClick={onRetry}
            disabled={!canRetry}
          >
            Retry
          </button>
        </div>
      ) : null}

      {hasSessions ? (
        <ul className="session-list" aria-label="Sessions in this project">
          {data.map((session) => {
            const selected = selectedSessionId === session.id;

            return (
              <li
                className={`session-item${selected ? " selected" : ""}`}
                key={session.id}
              >
                <button
                  type="button"
                  className="session-select"
                  aria-pressed={selected}
                  aria-label={`Select session: ${session.title || "Untitled session"}`}
                  onClick={() => onSelectSession(session.id)}
                >
                  <span className="session-title">
                    {session.title || "Untitled session"}
                  </span>
                  <span className="session-meta">
                    <span>{formatSessionTime(session.time?.updated)}</span>
                    <span>{session.agent || "agent"}</span>
                    <span
                      title={
                        session.model
                          ? `${session.model.providerID}/${session.model.id}`
                          : undefined
                      }
                    >
                      {session.model?.id || "default model"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {status === "ready" && !hasSessions ? (
        <div className="empty-sessions">
          <strong>No sessions in this project.</strong>
          <span>Sessions from other folders stay hidden here.</span>
        </div>
      ) : null}
    </div>
  );
}

function SidebarContent({
  health,
  sessions,
  canRefresh,
  connection,
  onRefresh,
  onClose,
  selectedSessionId,
  onSelectSession,
}) {
  const connected = Boolean(health.data?.healthy);
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
        disabled
        title="Session creation is coming in the next phase"
      >
        <span>＋ New session</span>
        <span className="soon">SOON</span>
      </button>

      <p className="section-label">WORKSPACE</p>
      <div className="nav-item active" aria-current="page">
        ⌘ Chat
      </div>
      <div
        className="nav-item disabled"
        aria-disabled="true"
        title="Session browsing is not available in this phase"
      >
        ▤ Sessions
        <span className="nav-count">
          {sessions.status === "ready" ? sessionCount : "—"}
        </span>
      </div>
      <div
        className="nav-item disabled"
        aria-disabled="true"
        title="Model selection is not available in this phase"
      >
        ⌁ Models
      </div>
      <div
        className="nav-item disabled"
        aria-disabled="true"
        title="Change review is not available in this phase"
      >
        ⌘ Changes
      </div>
      <div
        className="nav-item disabled"
        aria-disabled="true"
        title="Settings are not available in this phase"
      >
        ⚙ Settings
      </div>

      <div className="sessions-header">
        <p className="section-label">PROJECT SESSIONS</p>
        <span className="readonly-badge">READ ONLY</span>
      </div>

      <SessionList
        sessions={sessions}
        canRetry={canRefresh}
        onRetry={onRefresh}
        selectedSessionId={selectedSessionId}
        onSelectSession={onSelectSession}
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

export default function App() {
  const { health, sessions, refresh } = useOpenCodeOverview();
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const menuButtonRef = useRef(null);
  const drawerRef = useRef(null);
  const wasMenuOpen = useRef(false);

  const connected = Boolean(health.data?.healthy);
  const busy =
    health.status === "loading" ||
    health.status === "refreshing" ||
    sessions.status === "loading" ||
    sessions.status === "refreshing";
  const refreshing =
    health.status === "refreshing" || sessions.status === "refreshing";
  const connection = connected
    ? { tone: "online", label: refreshing ? "Refreshing" : "Connected" }
    : health.status === "offline"
      ? { tone: "offline", label: offlineLabel(health.errorKind) }
      : { tone: "loading", label: "Connecting" };
  const canRefresh = !busy;
  const busyLabel = refreshing
    ? "Refreshing connection and sessions"
    : "Loading connection and sessions";
  const sessionCount = sessions.data.length;

  const sessionFact =
    sessions.status === "error" && sessionCount === 0
      ? "Sessions unavailable"
      : sessionCount > 0
        ? `${sessionCount} project session${sessionCount === 1 ? "" : "s"}`
        : sessions.status === "ready"
          ? "No project sessions"
          : "Reading sessions";

  useEffect(() => {
    if (!menuOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = drawerRef.current?.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );

      if (!focusable?.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!drawerRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (menuOpen) {
      wasMenuOpen.current = true;
      return;
    }

    if (!wasMenuOpen.current) return;

    wasMenuOpen.current = false;

    if (menuButtonRef.current?.offsetParent) {
      menuButtonRef.current.focus();
    }
  }, [menuOpen]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 651px)");
    const handleChange = (event) => {
      if (event.matches) setMenuOpen(false);
    };

    desktop.addEventListener("change", handleChange);
    return () => desktop.removeEventListener("change", handleChange);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <button
            ref={menuButtonRef}
            type="button"
            className="icon-button menu-button"
            aria-label={menuOpen ? "Close workspace menu" : "Open workspace menu"}
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            aria-controls="mobile-workspace"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? "×" : "☰"}
          </button>
          <div className="brand">
            <span className="brand-icon">✳</span>
            <span>OpenCode</span>
            <span className="tag">MOBILE</span>
          </div>
        </div>

        <div className="topbar-right">
          <span
            className={`status status-${connection.tone}`}
            role="status"
            aria-live="polite"
            title={
              connected
                ? `${describeServer(OPENCODE_BASE_URL)} · v${health.data.version}`
                : health.error || "Checking the OpenCode server"
            }
          >
            <span className={`dot ${connection.tone}`} />
            <span>{connection.label}</span>
          </span>
          <button
            type="button"
            className={`icon-button refresh-button ${busy ? "is-refreshing" : ""}`}
            onClick={refresh}
            disabled={!canRefresh}
            aria-busy={busy}
            aria-label={busy ? busyLabel : "Refresh connection and sessions"}
            title={busy ? busyLabel : "Refresh connection and sessions"}
          >
            <span className="refresh-icon" aria-hidden="true">
              ↻
            </span>
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar" aria-label="Workspace navigation">
          <SidebarContent
            health={health}
            sessions={sessions}
            canRefresh={canRefresh}
            connection={connection}
            onRefresh={refresh}
            selectedSessionId={selectedSessionId}
            onSelectSession={setSelectedSessionId}
          />
        </aside>

        <main className="chat">
          <div className="chat-heading">
            <div>
              <p className="eyebrow">YOUR WORKSPACE</p>
              <h1>What are we building?</h1>
              <p className="subtitle">
                Your coding agent, in a workspace of your own.
              </p>
            </div>
            <span className="model-pill">◈ OpenCode</span>
          </div>

          {connection.tone === "offline" ? (
            <div className="connection-banner" role="alert">
              <div className="banner-copy">
                <strong>{offlineTitle(health.errorKind)}</strong>
                <span>{health.error || "Check the local server and retry."}</span>
              </div>
              <button
                type="button"
                className="retry-button"
                onClick={refresh}
                disabled={!canRefresh}
              >
                Retry
              </button>
            </div>
          ) : null}

          <section className="welcome" aria-live="polite">
            <div className={`welcome-icon ${connection.tone}`}>✳</div>

            {connected ? (
              <>
                <h2>Your workspace is connected.</h2>
                <p>
                  The local OpenCode server is healthy. Existing sessions for
                  this project are available in the sidebar. Creating sessions
                  and sending prompts will be enabled in the next phase.
                </p>
              </>
            ) : connection.tone === "offline" ? (
              <>
                <h2>{offlineTitle(health.errorKind)}.</h2>
                <p>{offlineHelp(health.errorKind)}</p>
              </>
            ) : (
              <>
                <h2>Looking for your workspace...</h2>
                <p>
                  Checking the local OpenCode server and reading this project's
                  sessions.
                </p>
              </>
            )}

            <div className="workspace-facts">
              <span className="fact">
                ◈{" "}
                {connected
                  ? `Server v${health.data.version}`
                  : connection.tone === "offline"
                    ? "Server offline"
                    : "Checking server"}
              </span>
              <span className="fact">▤ {sessionFact}</span>
              <span className="fact" title={PROJECT_DIRECTORY}>
                ⌁ opencode-mobile
              </span>
            </div>

            <div className="suggestions" aria-disabled="true">
              <button
                type="button"
                disabled
                title="Prompting is not enabled in this phase"
              >
                ◫ Explain my project
              </button>
              <button
                type="button"
                disabled
                title="Prompting is not enabled in this phase"
              >
                ⌁ Find a bug
              </button>
              <button
                type="button"
                disabled
                title="Prompting is not enabled in this phase"
              >
                ＋ Add a feature
              </button>
            </div>
          </section>

          <form className="composer" onSubmit={(event) => event.preventDefault()}>
            <textarea
              rows={3}
              disabled
              placeholder="Prompting will be enabled in the next phase"
              aria-label="Prompt input disabled in this phase"
              aria-describedby="composer-status"
            />
            <div className="composer-footer">
              <span id="composer-status">
                Read-only preview · Prompting is not available in this phase.
              </span>
              <button
                className="send"
                type="submit"
                disabled
                aria-label="Sending prompts is disabled in this phase"
                title="Sending prompts is disabled in this phase"
              >
                ↑
              </button>
            </div>
          </form>
          <p className="disclaimer">
            Review agent actions before allowing changes to your files.
          </p>
        </main>
      </section>

      {menuOpen ? (
        <div
          className="drawer-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setMenuOpen(false);
          }}
        >
          <aside
            ref={drawerRef}
            className="drawer"
            id="mobile-workspace"
            role="dialog"
            aria-modal="true"
            aria-label="Workspace navigation"
          >
            <SidebarContent
              health={health}
              sessions={sessions}
              canRefresh={canRefresh}
              connection={connection}
              onRefresh={refresh}
              onClose={() => setMenuOpen(false)}
              selectedSessionId={selectedSessionId}
              onSelectSession={setSelectedSessionId}
            />
          </aside>
        </div>
      ) : null}
    </div>
  );
}
