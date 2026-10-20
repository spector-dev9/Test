import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { ChangesView } from "./components/ChangesView";
import { ChatView } from "./components/ChatView";
import { ContextView } from "./components/ContextView";
import { FilesView } from "./components/FilesView";
import { ModelsView } from "./components/ModelsView";
import { SessionsView } from "./components/SessionsView";
import { LocalServerGate } from "./components/LocalServerGate";
import { SettingsView } from "./components/SettingsView";
import { SidebarContent } from "./components/Sidebar";
import { TerminalView } from "./components/TerminalView";
import { WorkspaceTabs } from "./components/WorkspaceTabs";
import { useLocalServer } from "./hooks/useLocalServer";
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
  normalizeProjectDirectory,
} from "./lib/project";
import { registerProjectDirectories } from "./lib/projectScope";
import {
  buildSessionTitle,
  describeServer,
  formatModelLabel,
  isModelSelectionValid,
  isSessionArchived,
  offlineLabel,
  resolveEffectiveModel,
} from "./lib/workspace";

const MODEL_STORAGE_KEY = "opencode-mobile.preferred-model";
const WORKSPACE_STORAGE_KEY = "opencode-mobile.workspace-directory";

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
      return {
        providerID: value.providerID,
        modelID: value.modelID,
        ...(typeof value.variant === "string" && value.variant
          ? { variant: value.variant }
          : {}),
      };
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

function readStoredWorkspaceDirectory() {
  if (typeof window === "undefined") return null;

  try {
    const directory = normalizeProjectDirectory(
      window.localStorage.getItem(WORKSPACE_STORAGE_KEY),
    );

    if (directory && directory !== PROJECT_DIRECTORY) {
      registerProjectDirectories([directory]);
      return directory;
    }
  } catch {
    return null;
  }

  return null;
}

function storeWorkspaceDirectory(directory) {
  if (typeof window === "undefined") return;

  try {
    if (directory) {
      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, directory);
    } else {
      window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
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
  if (typeof window === "undefined") return;

  try {
    if (projectId) {
      window.localStorage.setItem(PROJECT_STORAGE_KEY, projectId);
    } else {
      window.localStorage.removeItem(PROJECT_STORAGE_KEY);
    }
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
  const localServer = useLocalServer();
  const retryLocalServer = localServer.retry;
  const [serverGateDismissed, setServerGateDismissed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeView, setActiveView] = useState("chat");
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [preferredModel, setPreferredModel] = useState(readStoredModel);
  const [workspaceDirectory, setWorkspaceDirectory] = useState(
    readStoredWorkspaceDirectory,
  );
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
  const showServerGate =
    localServer.supported && !connected && !serverGateDismissed;

  useEffect(() => {
    if (localServer.state === "running") refreshProjects();
  }, [localServer.state, refreshProjects]);

  useEffect(() => {
    if (!localServer.supported || localServer.state !== "running" || connected) {
      return undefined;
    }

    const timer = window.setInterval(refreshProjects, 2500);
    return () => window.clearInterval(timer);
  }, [connected, localServer.state, localServer.supported, refreshProjects]);

  const workspaceProject = useMemo(() => {
    if (!workspaceDirectory) return null;

    const parts = workspaceDirectory.split("/").filter(Boolean);

    return {
      id: "device-workspace",
      name: parts[parts.length - 1] ?? "Workspace",
      worktree: workspaceDirectory,
    };
  }, [workspaceDirectory]);

  const scopedProjects = useMemo(() => {
    const scopeDirectory = workspaceDirectory ?? PROJECT_DIRECTORY;
    const allowed = projects.data.filter(
      (project) =>
        typeof project.worktree === "string" &&
        (project.worktree === scopeDirectory ||
          project.worktree.startsWith(`${scopeDirectory}/`)),
    );

    let data = allowed;

    if (workspaceProject) {
      const synthetic = allowed.some(
        (project) => project.worktree === workspaceProject.worktree,
      )
        ? []
        : [workspaceProject];
      data = [...synthetic, ...allowed];
    }

    return {
      ...projects,
      data:
        data.length > 0
          ? data
          : [workspaceProject ?? FALLBACK_PROJECT],
    };
  }, [projects, workspaceDirectory, workspaceProject]);

  const activeProject = useMemo(() => {
    const available = scopedProjects.data;
    const preferredDirectory = workspaceDirectory ?? PROJECT_DIRECTORY;

    return (
      available.find((project) => project.id === selectedProjectId) ??
      available.find((project) => project.worktree === preferredDirectory) ??
      available[0] ??
      workspaceProject ??
      FALLBACK_PROJECT
    );
  }, [scopedProjects.data, selectedProjectId, workspaceDirectory, workspaceProject]);
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
    return isModelSelectionValid(resources.models.data, preferredModel)
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

      if (!scopedProjects.data.some((project) => project.id === projectId)) {
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
      scopedProjects.data,
      sessionActionsDisabled,
    ],
  );

  const handleSelectWorkspace = useCallback(
    (directory) => {
      const normalized = normalizeProjectDirectory(directory);

      if (!normalized) {
        return { ok: false, error: "That folder path is not supported." };
      }

      const next = normalized === PROJECT_DIRECTORY ? null : normalized;

      if (next === workspaceDirectory) {
        return { ok: true };
      }

      if (next) registerProjectDirectories([next]);

      setWorkspaceDirectory(next);
      storeWorkspaceDirectory(next);
      setSelectedProjectId(null);
      storeProjectId(null);
      setSelectedSessionId(null);
      setDraft("");
      setActiveView("chat");
      setMenuOpen(false);

      return { ok: true };
    },
    [workspaceDirectory],
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

  const handleOpenRuntimeSettings = useCallback(() => {
    setServerGateDismissed(true);
    setActiveView("settings");
    setMenuOpen(false);
  }, []);

  const handleRetryRuntime = useCallback(() => {
    setServerGateDismissed(false);
    retryLocalServer();
  }, [retryLocalServer]);

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

  const handleSelectVariant = useCallback((model, variant) => {
    const next = {
      providerID: model.providerID,
      modelID: model.modelID,
      ...(variant ? { variant } : {}),
    };
    setPreferredModel(next);
    storeModel(next);
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
    projects: scopedProjects,
    activeProject,
    onSelectProject: handleSelectProject,
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
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
            onMenu={() => setMenuOpen((open) => !open)}
            menuButtonRef={menuButtonRef}
            menuOpen={menuOpen}
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

            <div className="view-pane" hidden={activeView !== "terminal"}>
              <TerminalView
                key={activeDirectory}
                directory={activeDirectory}
                connected={connected}
                project={activeProject}
                active={activeView === "terminal"}
                agent={selectedSession?.agent}
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
                onSelectVariant={handleSelectVariant}
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
                projects={scopedProjects}
                localServer={localServer}
                workspaceDirectory={workspaceDirectory}
                onSelectWorkspace={handleSelectWorkspace}
                onProjectsChanged={refreshProjects}
                onProvidersChanged={resources.refresh}
              />
            ) : null}
          </div>
        </main>
      </section>

      {showServerGate ? (
        <LocalServerGate
          status={localServer}
          connected={connected}
          onRetry={handleRetryRuntime}
          onOpenSettings={handleOpenRuntimeSettings}
        />
      ) : null}

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
