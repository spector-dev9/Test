import { projectLabel } from "../lib/project";
import {
  patchForFile,
  summarizeDiffs,
} from "../lib/workspace";

export function ChangesView({
  changes,
  onRefresh,
  connected,
  project,
}) {
  const summary = summarizeDiffs(changes.files);

  return (
    <section className="page-view" aria-labelledby="changes-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow">WORKSPACE</p>
          <h1 id="changes-heading">Changes</h1>
          <p className="subtitle">
            Uncommitted files reported by OpenCode's VCS integration for{" "}
            {project ? projectLabel(project) : "this project"}.
          </p>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={onRefresh}
          disabled={!connected || changes.status === "refreshing"}
        >
          Refresh
        </button>
      </div>

      <div className="panel changes-summary">
        <div>
          <span className="panel-kicker">WORKING TREE</span>
          <strong>
            {summary.files} file{summary.files === 1 ? "" : "s"}
          </strong>
        </div>
        <div className="diff-totals">
          <span className="additions">+{summary.additions}</span>
          <span className="deletions">−{summary.deletions}</span>
        </div>
      </div>

      {changes.status === "loading" ? (
        <div className="diff-list" aria-hidden="true">
          <span className="diff-skeleton" />
          <span className="diff-skeleton" />
          <span className="diff-skeleton" />
        </div>
      ) : null}

      {changes.status === "error" ? (
        <div className="inline-error page-error" role="alert">
          <span>{changes.error || "Changes could not be loaded."}</span>
          <button
            type="button"
            className="text-button"
            onClick={onRefresh}
            disabled={!connected}
          >
            Retry
          </button>
        </div>
      ) : null}

      {changes.status === "offline" ? (
        <div className="empty-panel">
          <strong>Changes are unavailable while the server is offline.</strong>
          <span>Reconnect, then refresh this view.</span>
        </div>
      ) : null}

      {changes.patchError ? (
        <p className="panel-note">
          File statistics loaded, but patches were not available:{" "}
          {changes.patchError}
        </p>
      ) : null}

      {changes.status === "ready" && changes.files.length === 0 ? (
        <div className="empty-panel">
          <strong>No uncommitted changes in this project.</strong>
          <span>
            OpenCode reports a clean working tree for the current project.
          </span>
        </div>
      ) : null}

      {changes.files.length > 0 ? (
        <div className="diff-list">
          {changes.files.map((file) => {
            const path = file.file ?? file.path ?? "unknown file";
            const patch = patchForFile(changes.diffs, path);

            return (
              <details className="diff-file" key={path}>
                <summary>
                  <span className="diff-path">{path}</span>
                  <span className="diff-stats">
                    <span className="additions">
                      +{file.additions ?? 0}
                    </span>
                    <span className="deletions">
                      −{file.deletions ?? 0}
                    </span>
                    <span className={`diff-state ${file.status ?? ""}`}>
                      {file.status ?? "modified"}
                    </span>
                  </span>
                </summary>
                {patch ? (
                  <pre className="diff-patch">{patch}</pre>
                ) : (
                  <p className="panel-note">
                    No patch was returned for this file.
                  </p>
                )}
              </details>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
