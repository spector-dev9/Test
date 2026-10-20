import { useEffect, useRef, useState } from "react";
import {
  formatSessionTime,
  isSessionArchived,
} from "../lib/workspace";

export function SessionDialog({
  session,
  disabled,
  onClose,
  onRename,
  onArchive,
  onDelete,
}) {
  const [title, setTitle] = useState(session.title || "");
  const [pending, setPending] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);
  const archived = isSessionArchived(session);
  const busy = Boolean(pending);

  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    inputRef.current?.select();

    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  async function run(kind, action) {
    if (busy || disabled) return;
    setPending(kind);
    setError(null);

    try {
      const result = await action();
      if (result?.ok === false) {
        setError(result.error?.message || "The session action failed.");
        return;
      }

      onClose();
    } finally {
      setPending(null);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!title.trim()) return;
    run("rename", () => onRename(session.id, title));
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="session-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-dialog-title"
      >
        <div className="session-dialog-head">
          <div>
            <span className="panel-kicker">MANAGE SESSION</span>
            <h2 id="session-dialog-title">
              {session.title || "Untitled session"}
            </h2>
            <p>
              Updated {formatSessionTime(session.time?.updated)}
              {archived ? " · Archived" : ""}
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close session dialog"
          >
            ×
          </button>
        </div>

        <form className="session-dialog-form" onSubmit={handleSubmit}>
          <label htmlFor="session-title-input">Session name</label>
          <div className="session-title-row">
            <input
              ref={inputRef}
              id="session-title-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              disabled={busy || disabled}
            />
            <button
              type="submit"
              className="primary-button"
              disabled={
                busy ||
                disabled ||
                !title.trim() ||
                title.trim() === (session.title || "")
              }
            >
              {pending === "rename" ? "Saving…" : "Save name"}
            </button>
          </div>
        </form>

        {error ? (
          <div className="inline-error session-dialog-error" role="alert">
            {error}
          </div>
        ) : null}

        <div className="session-dialog-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              run("archive", () => onArchive(session.id, !archived))
            }
            disabled={busy || disabled}
          >
            {pending === "archive"
              ? "Saving…"
              : archived
                ? "Restore session"
                : "Archive session"}
          </button>

          <button
            type="button"
            className="danger-button"
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }

              run("delete", () => onDelete(session.id));
            }}
            disabled={busy || disabled}
          >
            {pending === "delete"
              ? "Deleting…"
              : confirmDelete
                ? "Confirm permanent delete"
                : "Delete session"}
          </button>
        </div>

        <p className="session-dialog-note">
          {confirmDelete
            ? "This permanently removes the conversation and its history."
            : archived
              ? "Restoring returns the session to the active list."
              : "Archiving hides the session from the active list. Deleting is permanent."}
        </p>
      </section>
    </div>
  );
}
