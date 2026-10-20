import { SessionList } from "./SessionList";

export function SessionsView({
  sessions,
  selectedSessionId,
  onSelectSession,
  onNewSession,
  creatingSession,
  canRefresh,
  onRetry,
  connected,
  sessionActionsDisabled,
}) {
  return (
    <section className="page-view" aria-labelledby="sessions-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow">WORKSPACE</p>
          <h1 id="sessions-heading">Sessions</h1>
          <p className="subtitle">
            Conversations saved for this project on your local server.
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
                ? `${sessions.data.length} session${sessions.data.length === 1 ? "" : "s"}`
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

        <SessionList
          sessions={sessions}
          canRetry={canRefresh}
          onRetry={onRetry}
          selectedSessionId={selectedSessionId}
          onSelectSession={onSelectSession}
          disabled={sessionActionsDisabled}
          large
        />
      </div>
    </section>
  );
}
