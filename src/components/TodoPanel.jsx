import { orderTodos, todoIcon, todoSummary } from "../lib/todos.js";

const VISIBLE_LIMIT = 4;

export function TodoPanel({ todos, error, open, onToggle, onOpenAll }) {
  const list = Array.isArray(todos) ? todos : [];

  if (list.length === 0) return null;

  const { completed, total } = todoSummary(list);
  const ordered = orderTodos(list);
  const visible = ordered.slice(0, VISIBLE_LIMIT);
  const hidden = ordered.length - visible.length;

  return (
    <div className={`todo-panel${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="todo-panel-head"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="todo-panel-chevron" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span className="todo-panel-title">Tasks</span>
        <span className="todo-panel-count">
          {completed}/{total}
        </span>
      </button>

      {open ? (
        <div className="todo-panel-body">
          {error ? (
            <p className="todo-panel-error" role="alert">
              {error}
            </p>
          ) : null}

          <ul className="todo-panel-list">
            {visible.map((todo, index) => (
              <li
                className={`todo-panel-item ${todo.status}`}
                key={`${todo.content}-${index}`}
              >
                <span className="todo-panel-icon" aria-hidden="true">
                  {todoIcon(todo.status)}
                </span>
                <span className="todo-panel-text">{todo.content}</span>
              </li>
            ))}
          </ul>

          <div className="todo-panel-actions">
            {hidden > 0 ? (
              <span className="todo-panel-more">+{hidden} more</span>
            ) : null}
            <button
              type="button"
              className="text-button"
              onClick={onOpenAll}
            >
              View all tasks
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
