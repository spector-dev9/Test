import { useEffect, useRef, useState } from "react";

const TABS = [
  { id: "chat", label: "Chat", icon: "⌘" },
  { id: "files", label: "Files", icon: "◇" },
  { id: "context", label: "Context", icon: "◫" },
  { id: "terminal", label: "Terminal", icon: "›_" },
];

export function WorkspaceTabs({
  activeView,
  onNavigate,
  onAction,
  onMenu,
  menuButtonRef,
  menuOpen,
  connected,
  creatingSession,
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const menuRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!actionsOpen) return undefined;

    function handlePointer(event) {
      if (
        !menuRef.current?.contains(event.target) &&
        !buttonRef.current?.contains(event.target)
      ) {
        setActionsOpen(false);
      }
    }

    function handleKey(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setActionsOpen(false);
      buttonRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointer);
    document.addEventListener("keydown", handleKey);

    return () => {
      document.removeEventListener("pointerdown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [actionsOpen]);

  function runAction(action) {
    setActionsOpen(false);
    onAction(action);
  }

  return (
    <div className="workspace-tabs-bar">
      <button
        ref={menuButtonRef}
        type="button"
        className="workspace-menu-button"
        onClick={onMenu}
        aria-label={menuOpen ? "Close workspace menu" : "Open workspace menu"}
        aria-expanded={menuOpen}
        aria-haspopup="dialog"
        aria-controls="mobile-workspace"
      >
        <span className="menu-icon" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>

      <div className="workspace-tabs" role="tablist" aria-label="Workspace tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeView === tab.id}
            className={`workspace-tab${activeView === tab.id ? " active" : ""}`}
            onClick={() => onNavigate(tab.id)}
          >
            <span aria-hidden="true">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="workspace-action-wrap">
        <button
          ref={buttonRef}
          type="button"
          className={`icon-button workspace-add-button${actionsOpen ? " active" : ""}`}
          aria-label="Create or open"
          aria-haspopup="menu"
          aria-expanded={actionsOpen}
          onClick={() => setActionsOpen((value) => !value)}
        >
          ＋
        </button>
        {actionsOpen ? (
          <div
            ref={menuRef}
            className="workspace-action-menu"
            role="menu"
            aria-label="Workspace actions"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => runAction("new-session")}
              disabled={!connected || creatingSession}
            >
              <span aria-hidden="true">＋</span>
              <span>
                <strong>{creatingSession ? "Creating session…" : "New session"}</strong>
                <small>Start a project conversation</small>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => runAction("new-file")}
              disabled={!connected}
            >
              <span aria-hidden="true">◇</span>
              <span>
                <strong>New file</strong>
                <small>Create a file by saving a patch</small>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => runAction("find-file")}
              disabled={!connected}
            >
              <span aria-hidden="true">⌕</span>
              <span>
                <strong>Find file</strong>
                <small>Search by path or filename</small>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => runAction("refresh")}
              disabled={!connected}
            >
              <span aria-hidden="true">↻</span>
              <span>
                <strong>Refresh view</strong>
                <small>Reload the active workspace view</small>
              </span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
