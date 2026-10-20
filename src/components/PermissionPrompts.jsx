export function PermissionPrompts({
  permissions,
  onReply,
  busyId,
  error,
}) {
  if (permissions.length === 0 && !error) return null;

  return (
    <div className="permission-stack" aria-live="assertive">
      {error ? (
        <div className="inline-error permission-error" role="alert">
          {error}
        </div>
      ) : null}

      {permissions.slice(0, 3).map((request) => {
        const busy = busyId === request.id;
        const patterns = request.patterns.length > 0
          ? request.patterns
          : request.always;

        return (
          <section
            className="permission-prompt"
            key={request.id}
            role="alert"
            aria-label="Permission required"
          >
            <div className="permission-copy">
              <span className="panel-kicker">PERMISSION REQUIRED</span>
              <strong>{request.permission}</strong>
              {patterns.length > 0 ? (
                <div className="permission-patterns">
                  {patterns.slice(0, 4).map((pattern) => (
                    <code key={pattern}>{pattern}</code>
                  ))}
                  {patterns.length > 4 ? (
                    <span>+{patterns.length - 4} more</span>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="permission-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => onReply(request.id, "once")}
                disabled={Boolean(busyId)}
              >
                Allow once
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => onReply(request.id, "always")}
                disabled={Boolean(busyId)}
                title="Allow this permission for the rest of the session"
              >
                Always
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() => onReply(request.id, "reject")}
                disabled={Boolean(busyId)}
              >
                Reject
              </button>
              {busy ? <span className="permission-busy">Sending…</span> : null}
            </div>
          </section>
        );
      })}

      {permissions.length > 3 ? (
        <p className="permission-more">
          {permissions.length - 3} more permission
          {permissions.length - 3 === 1 ? "" : "s"} pending in this session.
        </p>
      ) : null}
    </div>
  );
}
