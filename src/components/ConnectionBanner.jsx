import { offlineTitle } from "../lib/workspace";

export function ConnectionBanner({
  health,
  show,
  canRetry,
  onRetry,
}) {
  if (!show) return null;

  return (
    <div className="connection-banner" role="alert">
      <div className="banner-copy">
        <strong>{offlineTitle(health.errorKind)}</strong>
        <span>{health.error || "Check the local server and retry."}</span>
      </div>
      <button
        type="button"
        className="retry-button"
        onClick={onRetry}
        disabled={!canRetry}
      >
        Retry
      </button>
    </div>
  );
}
