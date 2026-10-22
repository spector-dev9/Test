import { useMemo, useState } from "react";
import { projectLabel } from "../lib/project";
import { filterSessions } from "../lib/workspace";
import { SessionDialog } from "./SessionDialog";
import { SessionList } from "./SessionList";
import { SessionTransfer } from "./SessionTransfer";

export function SessionsView({
  sessions,
  project,
  selectedSessionId,
  onSelectSession,
  onNewSession,
  creatingSession,
  canRefresh,
  onRetry,
  connected,
  sessionActionsDisabled,
  showArchived,
  archivedCount,
  onToggleArchived,
  onRenameSession,
  onArchiveSession,
  onDeleteSession,
  onSessionsRefreshed,
}) {
  const [query, setQuery] = useState("");
  const [managedSession, setManagedSession] = useState(null);
  const filteredSessions = useMemo(
    () => filterSessions(sessions.data, query),
    [query, sessions.data],
  );
  const hasSearch = Boolean(query.trim());
  const noMatches =
    hasSearch &&
    sessions.data.length > 0 &&
    filteredSessions.length === 0;

  async function renameSession(sessionID, title) {
    return onRenameSession(sessionID, title);
  }

  async function archiveSession(sessionID, archived) {
    return onArchiveSession(sessionID, archived);
  }

  async function deleteSession(sessionID) {
    return onDeleteSession(sessionID);
  }

  return (
    <section className="page-view" aria-labelledby="sessions-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow">WORKSPACE</p>
          <h1 id="sessions-heading">Sessions</h1>
          <p className="subtitle">
            Conversations saved in{" "}
            <strong>{project ? projectLabel(project) : "this project"}</strong>{" "}
            on your local server.
          </p>
        </div>
        <button
          type="button"
          className="primary-button"
          onClick={onNewSession}
          disabled={
            !connected || creatingSession || sessionActionsDisabled
          }
        >
          ＋ {creatingSession ? "Creating…" : "New session"}
        </button>
      </div>

      <div className="panel sessions-panel">
        <div className="panel-heading">
          <div>
            <h2>Project sessions</h2>
            <p>
              {sessions.status === "ready"
                ? `${filteredSessions.length} session${filteredSessions.length === 1 ? "" : "s"} shown`
                : "Reading sessions…"}
            </p>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={onRetry}
            disabled={!canRefresh}
          >
            Refresh
          </button>
        </div>

        <div className="session-toolbar">
          <label className="session-search">
            <span>Search sessions</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Title, agent, or model"
              aria-label="Search sessions"
            />
            {query ? (
              <button
                type="button"
                className="search-clear"
                onClick={() => setQuery("")}
                aria-label="Clear session search"
              >
                ×
              </button>
            ) : null}
          </label>

          <button
            type="button"
            className={`filter-button${showArchived ? " active" : ""}`}
            onClick={onToggleArchived}
            aria-pressed={showArchived}
          >
            {showArchived ? "Hide archived" : "Show archived"}
            {archivedCount > 0 ? (
              <span className="filter-count">{archivedCount}</span>
            ) : null}
          </button>
        </div>

        {noMatches ? (
          <div className="empty-panel session-search-empty">
            <strong>No sessions match “{query.trim()}”.</strong>
            <span>Try a different title, agent, or model.</span>
          </div>
        ) : (
          <SessionList
            sessions={{ ...sessions, data: filteredSessions }}
            canRetry={canRefresh}
            onRetry={onRetry}
            selectedSessionId={selectedSessionId}
            onSelectSession={onSelectSession}
            onManageSession={setManagedSession}
            disabled={sessionActionsDisabled}
            large
          />
        )}
      </div>

      <SessionTransfer
        sessions={sessions}
        directory={project?.worktree}
        onSessionsRefreshed={onSessionsRefreshed}
      />

      {managedSession ? (
        <SessionDialog
          key={managedSession.id}
          session={managedSession}
          disabled={sessionActionsDisabled}
          onClose={() => setManagedSession(null)}
          onRename={renameSession}
          onArchive={archiveSession}
          onDelete={deleteSession}
        />
      ) : null}
    </section>
  );
}
