import { useMemo, useState } from "react";
import { projectLabel } from "../lib/project";
import { CopyButton } from "./CopyButton";
import { parseUnifiedPatch } from "../lib/diff";
import {
  patchForFile,
  summarizeDiffs,
} from "../lib/workspace";

function SideBySideDiff({ patch }) {
  const hunks = useMemo(() => parseUnifiedPatch(patch), [patch]);

  if (hunks.length === 0) {
    return <pre className="diff-patch">{patch}</pre>;
  }

  return (
    <div className="diff-split">
      {hunks.map((hunk, hunkIndex) => (
        <div className="diff-hunk" key={`${hunk.oldStart}-${hunk.newStart}-${hunkIndex}`}>
          {hunk.context ? (
            <div className="diff-hunk-head">
              @@ -{hunk.oldStart} +{hunk.newStart} @@ {hunk.context}
            </div>
          ) : null}
          <table className="diff-side">
            <tbody>
              {hunk.rows.map((row, rowIndex) => (
                <tr key={`${rowIndex}-${row.kind}`} className={`diff-row diff-${row.kind}`}>
                  <td className="diff-num">{row.left ? row.left.no : ""}</td>
                  <td className="diff-cell">
                    {row.left
                      ? `${row.kind === "change" || row.kind === "remove" ? "-" : " "}${row.left.text}`
                      : ""}
                  </td>
                  <td className="diff-num">{row.right ? row.right.no : ""}</td>
                  <td className="diff-cell">
                    {row.right
                      ? `${row.kind === "change" || row.kind === "add" ? "+" : " "}${row.right.text}`
                      : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export function ChangesView({
  changes,
  onRefresh,
  connected,
  project,
  onOpenFile,
  onRevertFile,
}) {
  const summary = summarizeDiffs(changes.files);
  const [viewMode, setViewMode] = useState("split");
  const [revertingPath, setRevertingPath] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  async function revertFile(path, patch) {
    if (!connected || !patch || revertingPath) return;

    if (
      !window.confirm(
        `Revert ${path}? This discards its uncommitted changes and cannot be undone from this screen.`,
      )
    ) {
      return;
    }

    setRevertingPath(path);
    setActionError("");
    setActionMessage("");

    try {
      await onRevertFile?.(path, patch);
      setActionMessage(`Reverted ${path}.`);
    } catch (error) {
      setActionError(
        error instanceof Error && error.message
          ? error.message
          : "The file could not be reverted.",
      );
    } finally {
      setRevertingPath("");
    }
  }

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
        <div className="diff-view-toggle" role="group" aria-label="Diff view mode">
          <button
            type="button"
            className={`filter-button compact-button${viewMode === "split" ? " active" : ""}`}
            aria-pressed={viewMode === "split"}
            onClick={() => setViewMode("split")}
          >
            Side by side
          </button>
          <button
            type="button"
            className={`filter-button compact-button${viewMode === "unified" ? " active" : ""}`}
            aria-pressed={viewMode === "unified"}
            onClick={() => setViewMode("unified")}
          >
            Unified
          </button>
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

      {actionError ? (
        <div className="inline-error page-error" role="alert">
          <span>{actionError}</span>
        </div>
      ) : null}

      {actionMessage ? (
        <div className="panel-note" role="status">
          {actionMessage}
        </div>
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
                <div className="diff-file-actions">
                  <CopyButton
                    text={path}
                    label="Copy path"
                    title={`Copy ${path}`}
                    className="compact-button"
                  />
                  {patch ? (
                    <CopyButton
                      text={patch}
                      label="Copy diff"
                      title={`Copy the diff for ${path}`}
                      className="compact-button"
                    />
                  ) : null}
                  <button
                    type="button"
                    className="secondary-button compact-button"
                    onClick={() => onOpenFile?.(path)}
                    disabled={!connected}
                    title="Open this file in the editor"
                  >
                    Open file
                  </button>
                  <button
                    type="button"
                    className="danger-button compact-button"
                    onClick={() => revertFile(path, patch)}
                    disabled={!connected || !patch || Boolean(revertingPath)}
                    title={
                      patch
                        ? `Revert uncommitted changes in ${path}`
                        : "A patch is required to revert this file"
                    }
                  >
                    {revertingPath === path ? "Reverting…" : "Revert file"}
                  </button>
                </div>
                {patch ? (
                  viewMode === "split" ? (
                    <SideBySideDiff patch={patch} />
                  ) : (
                    <pre className="diff-patch">{patch}</pre>
                  )
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
