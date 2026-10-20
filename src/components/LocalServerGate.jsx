const BUSY_STATES = new Set([
  "idle",
  "preparing",
  "downloading",
  "extracting",
  "starting",
]);

export function LocalServerGate({
  status,
  connected,
  onRetry,
  onOpenSettings,
}) {
  if (connected) return null;

  const failed = status.state === "error";
  const stopped = status.state === "stopped" || status.state === "unavailable";
  const busy = BUSY_STATES.has(status.state) || status.state === "running";
  const title = failed
    ? "OpenCode could not start"
    : stopped
      ? "OpenCode is stopped"
      : status.state === "running"
        ? "Waiting for OpenCode"
        : "Setting up OpenCode";
  const detail = failed
    ? status.error || status.message
    : stopped
      ? "Start the on-device runtime to reconnect."
      : status.message || "Preparing the on-device runtime.";

  return (
    <div className="server-gate-backdrop">
      <section
        className="server-gate"
        role="dialog"
        aria-modal="true"
        aria-labelledby="server-gate-title"
        aria-describedby="server-gate-detail"
      >
        <div className={`server-gate-icon ${failed ? "error" : ""}`}>✳</div>
        <p className="eyebrow">ON-DEVICE RUNTIME</p>
        <h1 id="server-gate-title">{title}</h1>
        <p className="server-gate-message" id="server-gate-detail">
          {detail}
        </p>

        {busy ? (
          <>
            <div
              className="server-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.max(0, Math.min(100, status.progress))}
              aria-label="OpenCode runtime setup progress"
            >
              <span style={{ width: `${Math.max(2, status.progress)}%` }} />
            </div>
            <p className="server-gate-progress">
              {Math.max(0, Math.min(100, status.progress))}%
              {status.version ? ` · v${status.version}` : ""}
            </p>
          </>
        ) : null}

        {failed || stopped ? (
          <div className="server-gate-actions">
            <button type="button" className="primary-button" onClick={onRetry}>
              {failed ? "Try again" : "Start runtime"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={onOpenSettings}
            >
              Runtime settings
            </button>
          </div>
        ) : (
          <p className="server-gate-note">
            The first launch downloads the OpenCode runtime over your network.
            Later launches start from local storage.
          </p>
        )}

        {!failed && !stopped ? (
          <button
            type="button"
            className="server-gate-link"
            onClick={onOpenSettings}
          >
            Runtime settings
          </button>
        ) : null}
      </section>
    </div>
  );
}
