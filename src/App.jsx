import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { ChangesView } from "./components/ChangesView";
import { ChatView } from "./components/ChatView";
import { ContextView } from "./components/ContextView";
import { FilesView } from "./components/FilesView";
import { ModelsView } from "./components/ModelsView";
import { SessionsView } from "./components/SessionsView";
import { SettingsView } from "./components/SettingsView";
import { SidebarContent } from "./components/Sidebar";
import { WorkspaceTabs } from "./components/WorkspaceTabs";
import { useOpenCodeOverview } from "./hooks/useOpenCodeOverview";
import { useOpenCodeProjects } from "./hooks/useOpenCodeProjects";
import { useSessionConversation } from "./hooks/useSessionConversation";
import {
  useModelsAndCommands,
  useProjectChanges,
} from "./hooks/useWorkspaceResources";
import { OPENCODE_BASE_URL } from "./lib/opencode";
import {
  FALLBACK_PROJECT,
  PROJECT_DIRECTORY,
  PROJECT_STORAGE_KEY,
} from "./lib/project";
import {
  buildSessionTitle,
  describeServer,
  findModel,
  formatModelLabel,
  isSessionArchived,
  offlineLabel,
  resolveEffectiveModel,
} from "./lib/workspace";

const MODEL_STORAGE_KEY = "opencode-mobile.preferred-model";

function readStoredModel() {
  if (typeof window === "undefined") return null;

  try {
    const value = JSON.parse(
      window.localStorage.getItem(MODEL_STORAGE_KEY) ?? "null",
    );

    if (
      value &&
      typeof value.providerID === "string" &&
      typeof value.modelID === "string"
    ) {
      return value;
    }
  } catch {
    return null;
  }

  return null;
}

function storeModel(model) {
  if (typeof window === "undefined") return;

  try {
    if (model) {
      window.localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(model));
    } else {
      window.localStorage.removeItem(MODEL_STORAGE_KEY);
    }
  } catch {
    return;
  }
}

function readStoredProjectId() {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(PROJECT_STORAGE_KEY);
    return typeof value === "string" && value.length <= 200
      ? value
      : null;
  } catch {
    return null;
  }
}

function storeProjectId(projectId) {
  if (typeof window === "undefined" || !projectId) return;

  try {
    window.localStorage.setItem(PROJECT_STORAGE_KEY, projectId);
  } catch {
    return;
  }
}

export default function App() {
  const {
    health,
    projects,
    refresh: refreshProjects,
  } = useOpenCodeProjects();
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeView, setActiveView] = useState("chat");
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [preferredModel, setPreferredModel] = useState(readStoredModel);
  const [selectedProjectId, setSelectedProjectId] = useState(
    readStoredProjectId,
  );
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState("");
  const [fileIntent, setFileIntent] = useState(null);
  const menuButtonRef = useRef(null);
  const drawerRef = useRef(null);
  const wasMenuOpen = useRef(false);

  const connected = Boolean(health.data?.healthy);
  const activeProject = useMemo(() => {
    const available = projects.data;
    return (
      available.find((project) => project.id === selectedProjectId) ??
      available.find((project) => project.worktree === PROJECT_DIRECTORY) ??
      available[0] ??
      FALLBACK_PROJECT
    );
  }, [projects.data, selectedProjectId]);
  const activeDirectory = activeProject.worktree;

  const overview = useOpenCodeOverview({
    directory: activeDirectory,
    enabled: connected,
  });
  const {
    sessions,
    createSession,
    creatingSession,
    createError,
    renameSession,
    setSessionArchived,
    deleteSession,
  } = overview;

  const resources = useModelsAndCommands(activeDirectory, connected);
  const { changes, refresh: refreshChanges } = useProjectChanges({
    directory: activeDirectory,
    connected,
    active: activeView === "changes",
  });
  const conversation = useSessionConversation({
    directory: activeDirectory,
    sessionId: selectedSessionId,
    enabled: connected,
    onRefreshSessions: overview.refresh,
  });
  const refreshConversation = conversation.refresh;

  const refresh = useCallback(() => {
    refreshProjects();
    overview.refresh();
    resources.refresh();

    if (activeView === "changes") {
      refreshChanges();
    }
  }, [
    activeView,
    overview,
    refreshChanges,
    refreshProjects,
    resources,
  ]);

  const refreshBusy =
    health.status === "loading" ||
    health.status === "refreshing" ||
    projects.status === "loading" ||
    projects.status === "refreshing" ||
    sessions.status === "loading" ||
    sessions.status === "refreshing";
  const refreshing =
    health.status === "refreshing" ||
    projects.status === "refreshing" ||
    sessions.status === "refreshing";
  const connection = connected
    ? { tone: "online", label: refreshing ? "Refreshing" : "Connected" }
    : health.status === "offline"
      ? { tone: "offline", label: offlineLabel(health.errorKind) }
      : { tone: "loading", label: "Connecting" };
  const canRefresh = !refreshBusy;
  const busyLabel = refreshing
    ? "Refreshing connection, projects, and sessions"
    : "Loading connection, projects, and sessions";

  const archivedCount = useMemo(
    () => sessions.data.filter(isSessionArchived).length,
    [sessions.data],
  );
  const visibleSessionData = useMemo(
    () =>
      showArchived
        ? sessions.data
        : sessions.data.filter((session) => !isSessionArchived(session)),
    [sessions.data, showArchived],
  );
  const displayedSessions = useMemo(
    () => ({ ...sessions, data: visibleSessionData }),
    [sessions, visibleSessionData],
  );
  const selectedSession = useMemo(
    () =>
      sessions.data.find((session) => session.id === selectedSessionId) ??
      visibleSessionData[0] ??
      sessions.data[0] ??
      null,
    [selectedSessionId, sessions.data, visibleSessionData],
  );
  const activeSessionId = selectedSession?.id ?? null;

  const validPreferredModel = useMemo(() => {
    if (!preferredModel) return null;
    if (!resources.models.data) return preferredModel;
    return findModel(resources.models.data, preferredModel)
      ? preferredModel
      : null;
  }, [preferredModel, resources.models.data]);

  const effectiveModel = useMemo(
    () =>
      resolveEffectiveModel({
        preferred: validPreferredModel,
        session: selectedSession,
        providersData: resources.models.data,
      }),
    [validPreferredModel, resources.models.data, selectedSession],
  );
  const modelLabel = formatModelLabel(
    effectiveModel,
    resources.models.data,
  );
  const sessionActionsDisabled = [
    "sending",
    "working",
    "stopping",
  ].includes(conversation.phase);

  useEffect(() => {
    if (!menuOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = drawerRef.current?.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
      } else if (!drawerRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (menuOpen) {
      wasMenuOpen.current = true;
      return;
    }

    if (!wasMenuOpen.current) return;

    wasMenuOpen.current = false;

    if (menuButtonRef.current?.offsetParent) {
      menuButtonRef.current.focus();
    }
  }, [menuOpen]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 651px)");
    const handleChange = (event) => {
      if (event.matches) setMenuOpen(false);
    };

    desktop.addEventListener("change", handleChange);
    return () => desktop.removeEventListener("change", handleChange);
  }, []);

  const handleNewSession = useCallback(async () => {
    if (!connected || creatingSession || sessionActionsDisabled) {
      return null;
    }

    const session = await createSession({
      title: buildSessionTitle(),
      model: effectiveModel,
    });

    if (session) {
      setSelectedSessionId(session.id);
      setActiveView("chat");
      setDraft("");
      setMenuOpen(false);
    }

    return session;
  }, [
    connected,
    createSession,
    creatingSession,
    effectiveModel,
    sessionActionsDisabled,
  ]);

  const handleSelectSession = useCallback(
    (sessionId) => {
      if (sessionActionsDisabled) return;
      setSelectedSessionId(sessionId);
      setActiveView("chat");
      setMenuOpen(false);
    },
    [sessionActionsDisabled],
  );

  const handleSelectProject = useCallback(
    (projectId) => {
      if (
        projectId === activeProject.id ||
        sessionActionsDisabled ||
        creatingSession
      ) {
        return;
      }

      if (!projects.data.some((project) => project.id === projectId)) {
        return;
      }

      setSelectedProjectId(projectId);
      storeProjectId(projectId);
      setSelectedSessionId(null);
      setDraft("");
      setActiveView("chat");
      setMenuOpen(false);
    },
    [
      activeProject.id,
      creatingSession,
      projects.data,
      sessionActionsDisabled,
    ],
  );

  const handleArchiveSession = useCallback(
    async (sessionID, archived) => {
      const result = await setSessionArchived(sessionID, archived);

      if (
        result.ok &&
        archived &&
        !showArchived &&
        selectedSessionId === sessionID
      ) {
        setSelectedSessionId(null);
      }

      return result;
    },
    [selectedSessionId, setSessionArchived, showArchived],
  );

  const handleNavigate = useCallback((view) => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    setActiveView(view);
    setMenuOpen(false);
  }, []);

  const handleWorkspaceAction = useCallback(
    (action) => {
      if (action === "new-session") {
        handleNewSession();
        return;
      }

      if (action === "new-file" || action === "find-file") {
        handleNavigate("files");
        setFileIntent({ kind: action, nonce: Date.now() });
        return;
      }

      if (action === "refresh") {
        handleNavigate(activeView);
        if (activeView === "files") {
          setFileIntent({ kind: "refresh", nonce: Date.now() });
        } else if (activeView === "context" || activeView === "chat") {
          refreshConversation();
        } else {
          refresh();
        }
      }
    },
    [activeView, handleNavigate, handleNewSession, refresh, refreshConversation],
  );

  const handleSelectModel = useCallback((model) => {
    setPreferredModel(model);
    storeModel(model);
    setActiveView("chat");
  }, []);

  const sharedSidebarProps = {
    health,
    sessions: displayedSessions,
    canRefresh,
    connection,
    onRefresh: refresh,
    activeView,
    onNavigate: handleNavigate,
    selectedSessionId: activeSessionId,
    onSelectSession: handleSelectSession,
    onNewSession: handleNewSession,
    creatingSession,
    createError,
    connected,
    sessionActionsDisabled,
    projects,
    activeProject,
    onSelectProject: handleSelectProject,
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <button
            ref={menuButtonRef}
            type="button"
            className="icon-button menu-button"
            aria-label={menuOpen ? "Close workspace menu" : "Open workspace menu"}
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            aria-controls="mobile-workspace"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? "×" : "☰"}
          </button>
          <div className="brand">
            <span className="brand-icon">✳</span>
            <span>OpenCode</span>
            <span className="tag">MOBILE</span>
          </div>
        </div>

        <div className="topbar-right">
          <span
            className={`status status-${connection.tone}`}
            role="status"
            aria-live="polite"
            title={
              connected
                ? `${describeServer(OPENCODE_BASE_URL)} · v${health.data.version}`
                : health.error || "Checking the OpenCode server"
            }
          >
            <span className={`dot ${connection.tone}`} />
            <span>{connection.label}</span>
          </span>
          <button
            type="button"
            className={`icon-button refresh-button ${refreshBusy ? "is-refreshing" : ""}`}
            onClick={refresh}
            disabled={!canRefresh}
            aria-busy={refreshBusy}
            aria-label={refreshBusy ? busyLabel : "Refresh connection and sessions"}
            title={refreshBusy ? busyLabel : "Refresh connection and sessions"}
          >
            <span className="refresh-icon" aria-hidden="true">
              ↻
            </span>
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar" aria-label="Workspace navigation">
          <SidebarContent {...sharedSidebarProps} />
        </aside>

        <main className="main-area">
          <WorkspaceTabs
            activeView={activeView}
            onNavigate={handleNavigate}
            onAction={handleWorkspaceAction}
            connected={connected}
            creatingSession={creatingSession}
          />

          <div className="main-content">
            <div className="view-pane" hidden={activeView !== "chat"}>
              <ChatView
                health={health}
                connected={connected}
                connection={connection}
                canRefresh={canRefresh}
                onRefresh={refresh}
                session={selectedSession}
                project={activeProject}
                messages={conversation.messages}
                phase={conversation.phase}
                actionError={conversation.actionError}
                lastSubmission={conversation.lastSubmission}
                permissions={conversation.permissions}
                permissionError={conversation.permissionError}
                replyingPermissionId={conversation.replyingPermissionId}
                onPermissionReply={conversation.respondToPermission}
                onSend={conversation.submit}
                onRetrySend={conversation.retryLast}
                onStop={conversation.stop}
                onRefreshMessages={conversation.refresh}
                onNewSession={handleNewSession}
                creatingSession={creatingSession}
                commands={resources.commands}
                effectiveModel={effectiveModel}
                modelLabel={modelLabel}
                onOpenModels={() => setActiveView("models")}
                draft={draft}
                onDraftChange={setDraft}
              />
            </div>

            <div className="view-pane" hidden={activeView !== "files"}>
              <FilesView
                key={activeDirectory}
                directory={activeDirectory}
                connected={connected}
                project={activeProject}
                active={activeView === "files"}
                intent={fileIntent}
              />
            </div>

            <div className="view-pane" hidden={activeView !== "context"}>
              <ContextView
                session={selectedSession}
                project={activeProject}
                messages={conversation.messages}
                providersData={resources.models.data}
                effectiveModel={effectiveModel}
                modelLabel={modelLabel}
                phase={conversation.phase}
                permissions={conversation.permissions}
                connected={connected}
                onRefresh={conversation.refresh}
                onOpenChat={() => handleNavigate("chat")}
                onNewSession={handleNewSession}
                creatingSession={creatingSession}
              />
            </div>

            {activeView === "sessions" ? (
              <SessionsView
                sessions={displayedSessions}
                project={activeProject}
                selectedSessionId={activeSessionId}
                onSelectSession={handleSelectSession}
                onNewSession={handleNewSession}
                creatingSession={creatingSession}
                canRefresh={canRefresh}
                onRetry={refresh}
                connected={connected}
                sessionActionsDisabled={sessionActionsDisabled}
                showArchived={showArchived}
                archivedCount={archivedCount}
                onToggleArchived={() => setShowArchived((value) => !value)}
                onRenameSession={renameSession}
                onArchiveSession={handleArchiveSession}
                onDeleteSession={deleteSession}
              />
            ) : null}

            {activeView === "models" ? (
              <ModelsView
                models={resources.models}
                preferredModel={validPreferredModel}
                effectiveModel={effectiveModel}
                onSelectModel={handleSelectModel}
                onRefresh={resources.refresh}
                connected={connected}
                project={activeProject}
              />
            ) : null}

            {activeView === "changes" ? (
              <ChangesView
                changes={changes}
                onRefresh={refreshChanges}
                connected={connected}
                project={activeProject}
              />
            ) : null}

            {activeView === "settings" ? (
              <SettingsView
                health={health}
                connection={connection}
                connected={connected}
                onRefresh={refresh}
                canRefresh={canRefresh}
                project={activeProject}
                projects={projects}
              />
            ) : null}
          </div>
        </main>
      </section>

      {menuOpen ? (
        <div
          className="drawer-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setMenuOpen(false);
          }}
        >
          <aside
            ref={drawerRef}
            className="drawer"
            id="mobile-workspace"
            role="dialog"
            aria-modal="true"
            aria-label="Workspace navigation"
          >
            <SidebarContent
              {...sharedSidebarProps}
              onClose={() => setMenuOpen(false)}
            />
          </aside>
        </div>
      ) : null}
    </div>
  );
}
