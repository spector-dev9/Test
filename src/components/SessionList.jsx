import { formatSessionTime } from "../lib/workspace";

export function SessionList({
  sessions,
  canRetry,
  onRetry,
  selectedSessionId,
  onSelectSession,
  disabled = false,
  large = false,
}) {
  const { status, data, error } = sessions;
  const hasSessions = data.length > 0;

  return (
    <div
      className={`session-block${large ? " session-block-large" : ""}`}
      aria-busy={status === "loading" || status === "refreshing"}
    >
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
                  aria-label={`Open session: ${session.title || "Untitled session"}`}
                  onClick={() => onSelectSession(session.id)}
                  disabled={disabled}
                  title={
                    disabled
                      ? "Wait for the current response to finish"
                      : undefined
                  }
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
          <span>Create a session to start a conversation.</span>
        </div>
      ) : null}
    </div>
  );
}
