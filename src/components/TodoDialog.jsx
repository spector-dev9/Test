import { useEffect } from "react";

const STATUS_LABELS = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_ICONS = {
  pending: "○",
  in_progress: "◐",
  completed: "✓",
  cancelled: "×",
};

export function TodoDialog({ open, todos, error, onClose }) {
  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  const completed = todos.filter(
    (todo) => todo.status === "completed",
  ).length;

  return (
    <div
      className="todo-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="todo-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="todo-dialog-title"
      >
        <div className="todo-dialog-head">
          <div>
            <span className="panel-kicker">TASKS</span>
            <h2 id="todo-dialog-title">Session todo list</h2>
          </div>
          <button
            type="button"
            className="todo-close"
            onClick={onClose}
            aria-label="Close todo list"
          >
            ×
          </button>
        </div>

        {error ? (
          <div className="inline-error todo-error" role="alert">
            {error}
          </div>
        ) : null}

        {todos.length > 0 ? (
          <>
            <p className="todo-summary">
              {completed} of {todos.length} complete
            </p>
            <ol className="todo-list">
              {todos.map((todo, index) => (
                <li
                  className={`todo-item ${todo.status} priority-${todo.priority}`}
                  key={`${todo.content}-${index}`}
                >
                  <span className={`todo-status ${todo.status}`} aria-hidden="true">
                    {STATUS_ICONS[todo.status]}
                  </span>
                  <span className="todo-content">{todo.content}</span>
                  <span className={`todo-priority ${todo.priority}`}>
                    {todo.priority}
                  </span>
                  <span className={`todo-state ${todo.status}`}>
                    {STATUS_LABELS[todo.status]}
                  </span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="todo-empty">
            This session has no tasks yet. The agent can add them with the
            todo tool.
          </p>
        )}
      </section>
    </div>
  );
}
