import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { connectionFailure } from "../lib/connection";
import {
  MAX_FILE_TABS,
  basename,
  buildFilePatch,
  detectLineEnding,
  fileLanguage,
  fromEditorText,
  isPatchableFilePath,
  normalizePatchPath,
  toEditorText,
} from "../lib/files";
import { projectLabel } from "../lib/project";
import {
  applyProjectPatch,
  listProjectFiles,
  readProjectFile,
  searchProjectFiles,
} from "../lib/opencode";

const initialListing = {
  status: "idle",
  data: [],
  error: null,
};

function parentPath(path) {
  const index = path.lastIndexOf("/");
  return index === -1 ? "." : path.slice(0, index);
}

function tabForFile(path, overrides = {}) {
  return {
    path,
    status: "loading",
    type: "text",
    mimeType: null,
    baseline: "",
    content: "",
    lineEnding: "\n",
    isNew: false,
    dirty: false,
    error: null,
    saving: false,
    saveError: null,
    ...overrides,
  };
}

function replaceTab(tabs, path, updater) {
  return tabs.map((tab) =>
    tab.path === path ? updater(tab) : tab,
  );
}

function TreeRows({
  path,
  depth,
  tree,
  expanded,
  showIgnored,
  onToggle,
  onOpen,
}) {
  const listing = tree[path] ?? initialListing;

  if (listing.status === "loading" && listing.data.length === 0) {
    return (
      <div className="file-tree-loading" aria-label="Loading files">
        <span />
        <span />
        <span />
      </div>
    );
  }

  if (listing.status === "error") {
    return (
      <div className="file-tree-error">
        <span>{listing.error}</span>
        <button
          type="button"
          className="text-button"
          onClick={() => onToggle(path, true)}
        >
          Retry
        </button>
      </div>
    );
  }

  const rows = listing.data.filter(
    (entry) => showIgnored || !entry.ignored,
  );

  if (rows.length === 0) {
    return (
      <p className="file-tree-empty">
        {listing.status === "ready" ? "Empty directory" : "Loading…"}
      </p>
    );
  }

  return (
    <ul className="file-tree" role={path === "." ? "tree" : "group"}>
      {rows.map((entry) => {
        const isDirectory = entry.type === "directory";
        const isExpanded = expanded.has(entry.path);

        return (
          <li key={entry.path} role="treeitem" aria-expanded={isDirectory ? isExpanded : undefined}>
            <button
              type="button"
              className={`file-tree-row ${entry.ignored ? "ignored" : ""}`}
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() =>
                isDirectory ? onToggle(entry.path) : onOpen(entry.path)
              }
              title={entry.path}
            >
              <span className="file-tree-caret" aria-hidden="true">
                {isDirectory ? (isExpanded ? "▾" : "▸") : ""}
              </span>
              <span className="file-tree-icon" aria-hidden="true">
                {isDirectory ? "▱" : "◇"}
              </span>
              <span className="file-tree-name">{entry.name}</span>
              {entry.ignored ? (
                <span className="file-tree-ignored">ignored</span>
              ) : null}
            </button>
            {isDirectory && isExpanded ? (
              <TreeRows
                path={entry.path}
                depth={depth + 1}
                tree={tree}
                expanded={expanded}
                showIgnored={showIgnored}
                onToggle={onToggle}
                onOpen={onOpen}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function FilesView({ directory, connected, project, active, intent }) {
  const [tree, setTree] = useState({});
  const [expanded, setExpanded] = useState(() => new Set());
  const [showIgnored, setShowIgnored] = useState(false);
  const [tabs, setTabs] = useState([]);
  const [activePath, setActivePath] = useState(null);
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState("");
  const [searchState, setSearchState] = useState({
    status: "idle",
    data: [],
    error: null,
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [createError, setCreateError] = useState(null);
  const searchInputRef = useRef(null);
  const createInputRef = useRef(null);
  const editorRef = useRef(null);
  const gutterRef = useRef(null);
  const mountedRef = useRef(true);
  const treeRef = useRef(tree);
  const loadingPathsRef = useRef(new Set());
  const openRequestRef = useRef(new Map());
  const saveRequestRef = useRef(new Map());
  const reloadActiveRef = useRef(null);
  const handledIntentRef = useRef(intent?.nonce ?? 0);

  const loadDirectory = useCallback(
    async (path, { force = false } = {}) => {
      if (!directory || !connected) return;

      if (loadingPathsRef.current.has(path)) return;

      if (!force) {
        const current = treeRef.current[path];
        if (current?.status === "ready" || current?.status === "loading") {
          return;
        }
      }

      loadingPathsRef.current.add(path);
      setTree((previous) => ({
        ...previous,
        [path]: {
          status: "loading",
          data: previous[path]?.data ?? [],
          error: null,
        },
      }));

      try {
        const data = await listProjectFiles(directory, path);
        if (!mountedRef.current) return;

        setTree((previous) => ({
          ...previous,
          [path]: { status: "ready", data, error: null },
        }));
      } catch (error) {
        if (!mountedRef.current) return;
        const failure = connectionFailure(
          error,
          "This directory could not be loaded.",
        );
        setTree((previous) => ({
          ...previous,
          [path]: {
            status: "error",
            data: previous[path]?.data ?? [],
            error: failure.message,
          },
        }));
      } finally {
        loadingPathsRef.current.delete(path);
      }
    },
    [connected, directory],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  useEffect(
    () => () => {
      for (const controller of openRequestRef.current.values()) {
        controller.abort();
      }
      for (const controller of saveRequestRef.current.values()) {
        controller.abort();
      }
      openRequestRef.current.clear();
      saveRequestRef.current.clear();
      loadingPathsRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (!active || !connected || !directory) return undefined;

    const timer = setTimeout(() => {
      loadDirectory(".");
    }, 0);

    return () => clearTimeout(timer);
  }, [active, connected, directory, loadDirectory]);

  useEffect(() => {
    if (!active || !connected || search.trim().length < 2) {
      return undefined;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearchState((previous) => ({
        status: "loading",
        data: previous.data,
        error: null,
      }));

      try {
        const data = await searchProjectFiles(
          directory,
          search,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setSearchState({ status: "ready", data, error: null });
      } catch (error) {
        if (controller.signal.aborted) return;
        const failure = connectionFailure(
          error,
          "Files could not be searched.",
        );
        setSearchState({
          status: "error",
          data: [],
          error: failure.message,
        });
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, connected, directory, search]);

  const openFile = useCallback(
    async (path) => {
      if (!directory || !connected) return;

      const existing = tabs.find((tab) => tab.path === path);
      if (existing) {
        setActivePath(path);
        setEditing(false);
        return;
      }

      if (tabs.length >= MAX_FILE_TABS) {
        const firstClosed = tabs.find((tab) => !tab.dirty);
        if (!firstClosed && tabs.length >= MAX_FILE_TABS) {
          setSearchState((previous) => ({
            ...previous,
            error: `Close a tab before opening more than ${MAX_FILE_TABS} files.`,
          }));
          return;
        }

        if (firstClosed) {
          setTabs((current) =>
            current.filter((tab) => tab.path !== firstClosed.path),
          );
        }
      }

      const controller = new AbortController();
      openRequestRef.current.get(path)?.abort();
      openRequestRef.current.set(path, controller);
      setTabs((current) => [...current, tabForFile(path)]);
      setActivePath(path);
      setEditing(false);
      setSearch("");

      try {
        const data = await readProjectFile(
          directory,
          path,
          controller.signal,
        );
        if (controller.signal.aborted || !mountedRef.current) return;

        if (data.type === "binary") {
          setTabs((current) =>
            replaceTab(current, path, (tab) => ({
              ...tab,
              status: "ready",
              type: "binary",
              mimeType: data.mimeType,
              content: data.content,
              baseline: data.content,
              error: null,
            })),
          );
          return;
        }

        const lineEnding = detectLineEnding(data.content);
        setTabs((current) =>
          replaceTab(current, path, (tab) => ({
            ...tab,
            status: "ready",
            type: "text",
            baseline: data.content,
            content: toEditorText(data.content, lineEnding),
            lineEnding,
            dirty: false,
            error: null,
          })),
        );
      } catch (error) {
        if (controller.signal.aborted || !mountedRef.current) return;
        const failure = connectionFailure(
          error,
          "The file could not be opened.",
        );
        setTabs((current) =>
          replaceTab(current, path, (tab) => ({
            ...tab,
            status: "error",
            error: failure.message,
          })),
        );
      } finally {
        if (openRequestRef.current.get(path) === controller) {
          openRequestRef.current.delete(path);
        }
      }
    },
    [connected, directory, tabs],
  );

  const toggleDirectory = useCallback(
    (path, force = false) => {
      if (force) {
        loadDirectory(path, { force: true });
        return;
      }

      setExpanded((previous) => {
        const next = new Set(previous);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
          if (!tree[path] && !loadingPathsRef.current.has(path)) {
            loadDirectory(path);
          }
        }
        return next;
      });
    },
    [loadDirectory, tree],
  );

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.path === activePath) ?? null,
    [activePath, tabs],
  );

  const activeLines = useMemo(() => {
    if (!activeTab || activeTab.type !== "text") return 1;
    return activeTab.content.split("\n").length;
  }, [activeTab]);

  const refreshCurrent = useCallback(() => {
    if (activePath) {
      reloadActiveRef.current?.();
      return;
    }

    loadDirectory(".", { force: true });
    for (const path of expanded) {
      loadDirectory(path, { force: true });
    }
  }, [activePath, expanded, loadDirectory]);

  useEffect(() => {
    if (!intent || intent.nonce === handledIntentRef.current) {
      return undefined;
    }
    handledIntentRef.current = intent.nonce;

    const frame = requestAnimationFrame(() => {
      if (intent.kind === "new-file") {
        setCreateOpen(true);
        setCreateError(null);
        setNewPath("");
        createInputRef.current?.focus();
      } else if (intent.kind === "find-file") {
        searchInputRef.current?.focus();
      } else if (intent.kind === "refresh") {
        refreshCurrent();
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [intent, refreshCurrent]);

  useEffect(() => {
    if (createOpen) {
      requestAnimationFrame(() => createInputRef.current?.focus());
    }
  }, [createOpen]);

  function updateActive(mutator) {
    if (!activePath) return;
    setTabs((current) =>
      replaceTab(current, activePath, mutator),
    );
  }

  function changeContent(content) {
    updateActive((tab) => {
      const normalizedBaseline = toEditorText(tab.baseline, tab.lineEnding);
      return {
        ...tab,
        content,
        dirty: content !== normalizedBaseline,
        saveError: null,
      };
    });
  }

  function closeTab(path) {
    const tab = tabs.find((item) => item.path === path);
    if (
      tab?.dirty &&
      !window.confirm("Discard unsaved changes in this file?")
    ) {
      return;
    }

    openRequestRef.current.get(path)?.abort();
    saveRequestRef.current.get(path)?.abort();
    const remaining = tabs.filter((item) => item.path !== path);
    setTabs(remaining);

    if (activePath === path) {
      const next = remaining[remaining.length - 1] ?? null;
      setActivePath(next?.path ?? null);
      setEditing(false);
    }
  }

  function startCreateFile(event) {
    event?.preventDefault();

    if (!connected) {
      setCreateError("Reconnect to the OpenCode server first.");
      return;
    }

    const path = normalizePatchPath(newPath);
    if (!path) {
      setCreateError(
        "Use a relative path without spaces, quotes, or ../ segments.",
      );
      return;
    }

    if (tabs.some((tab) => tab.path === path)) {
      setCreateOpen(false);
      setActivePath(path);
      return;
    }

    if (tabs.length >= MAX_FILE_TABS) {
      setCreateError(`Close a tab before opening more than ${MAX_FILE_TABS} files.`);
      return;
    }

    setTabs((current) => [
      ...current,
      tabForFile(path, {
        status: "ready",
        isNew: true,
        content: "",
        baseline: "",
        lineEnding: "\n",
      }),
    ]);
    setActivePath(path);
    setEditing(true);
    setCreateOpen(false);
    setNewPath("");
    setCreateError(null);
    loadDirectory(parentPath(path));
  }

  async function reloadActive() {
    if (!activeTab || activeTab.isNew) return;
    if (
      activeTab.dirty &&
      !window.confirm("Discard unsaved changes and reload this file?")
    ) {
      return;
    }

    const path = activeTab.path;
    const controller = new AbortController();
    saveRequestRef.current.get(path)?.abort();
    saveRequestRef.current.set(path, controller);

    setTabs((current) =>
      replaceTab(current, path, (tab) => ({
        ...tab,
        status: "loading",
        saving: false,
        saveError: null,
      })),
    );

    try {
      const data = await readProjectFile(directory, path, controller.signal);
      if (controller.signal.aborted || !mountedRef.current) return;

      if (data.type === "binary") {
        setTabs((current) =>
          replaceTab(current, path, (tab) => ({
            ...tab,
            status: "ready",
            type: "binary",
            saving: false,
            mimeType: data.mimeType,
            baseline: data.content,
            content: data.content,
            dirty: false,
          })),
        );
        return;
      }

      const lineEnding = detectLineEnding(data.content);
      setTabs((current) =>
        replaceTab(current, path, (tab) => ({
          ...tab,
          status: "ready",
          saving: false,
          baseline: data.content,
          content: toEditorText(data.content, lineEnding),
          lineEnding,
          dirty: false,
          saveError: null,
        })),
      );
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current) return;
      const failure = connectionFailure(
        error,
        "The file could not be reloaded.",
      );
      setTabs((current) =>
        replaceTab(current, path, (tab) => ({
          ...tab,
          status: "error",
          saving: false,
          error: failure.message,
        })),
      );
    } finally {
      if (saveRequestRef.current.get(path) === controller) {
        saveRequestRef.current.delete(path);
      }
    }
  }

  useEffect(() => {
    reloadActiveRef.current = reloadActive;
  });

  async function saveActive() {
    if (
      !activeTab ||
      activeTab.status !== "ready" ||
      activeTab.type !== "text" ||
      activeTab.saving ||
      !activeTab.dirty
    ) {
      return;
    }

    const tab = activeTab;
    const path = tab.path;
    const controller = new AbortController();
    saveRequestRef.current.get(path)?.abort();
    saveRequestRef.current.set(path, controller);

    setTabs((current) =>
      replaceTab(current, path, (item) => ({
        ...item,
        saving: true,
        saveError: null,
      })),
    );

    try {
      if (!tab.isNew) {
        const currentFile = await readProjectFile(
          directory,
          path,
          controller.signal,
        );
        if (controller.signal.aborted) return;

        if (
          currentFile.type !== "text" ||
          currentFile.content !== tab.baseline
        ) {
          throw new TypeError(
            "This file changed on disk. Reload it before saving.",
          );
        }
      }

      const nextContent = fromEditorText(tab.content, tab.lineEnding);
      const patch = buildFilePatch({
        path,
        previousContent: tab.isNew ? "" : tab.baseline,
        nextContent,
        isNew: tab.isNew,
      });

      await applyProjectPatch(directory, patch, controller.signal);
      if (controller.signal.aborted || !mountedRef.current) return;

      setTabs((current) =>
        replaceTab(current, path, (item) => ({
          ...item,
          status: "ready",
          baseline: nextContent,
          content: toEditorText(nextContent, tab.lineEnding),
          isNew: false,
          dirty: false,
          saving: false,
          error: null,
          saveError: null,
        })),
      );

      loadDirectory(parentPath(path), { force: true });
      if (parentPath(path) !== ".") loadDirectory(".", { force: true });
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current) return;
      const failure = connectionFailure(
        error,
        "The file could not be saved.",
      );
      setTabs((current) =>
        replaceTab(current, path, (item) => ({
          ...item,
          saving: false,
          saveError: failure.message,
        })),
      );
    } finally {
      if (saveRequestRef.current.get(path) === controller) {
        saveRequestRef.current.delete(path);
      }
    }
  }

  const showSearchResults = search.trim().length >= 2;
  const canEditActive =
    activeTab?.status === "ready" &&
    activeTab.type === "text" &&
    isPatchableFilePath(activeTab.path);
  const saveDisabled =
    !canEditActive ||
    !activeTab.dirty ||
    activeTab.saving ||
    (activeTab.isNew && activeTab.content.length === 0);

  return (
    <section
      className={`files-view${activeTab ? " has-file" : ""}${editing ? " is-editing" : ""}`}
      aria-labelledby="files-heading"
    >
      <header className="files-toolbar">
        <div className="files-heading">
          <span className="panel-kicker">PROJECT</span>
          <h1 id="files-heading">
            Files
            <span className="files-project">
              {project ? projectLabel(project) : ""}
            </span>
          </h1>
        </div>
        <div className="files-toolbar-actions">
          <button
            type="button"
            className="secondary-button compact-button"
            onClick={() => {
              setCreateOpen(true);
              setCreateError(null);
            }}
            disabled={!connected}
          >
            ＋ New file
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={refreshCurrent}
            disabled={!connected}
            aria-label="Refresh files"
            title="Refresh files"
          >
            ↻
          </button>
        </div>
      </header>

      <div className="files-workbench">
        <aside className="file-explorer" aria-label="File explorer">
          <div className="file-search">
            <label htmlFor="file-search-input">FIND FILE</label>
            <input
              ref={searchInputRef}
              id="file-search-input"
              type="search"
              value={search}
              onChange={(event) => {
                const value = event.target.value;
                setSearch(value);
                if (value.trim().length < 2) {
                  setSearchState({ status: "idle", data: [], error: null });
                }
              }}
              placeholder="Search project files…"
              autoComplete="off"
              spellCheck="false"
              disabled={!connected}
            />
            {search ? (
              <button
                type="button"
                className="search-clear"
                onClick={() => {
                  setSearch("");
                  setSearchState({ status: "idle", data: [], error: null });
                  searchInputRef.current?.focus();
                }}
                aria-label="Clear file search"
              >
                ×
              </button>
            ) : null}
          </div>

          {createOpen ? (
            <form className="new-file-form" onSubmit={startCreateFile}>
              <label htmlFor="new-file-path">NEW FILE PATH</label>
              <input
                ref={createInputRef}
                id="new-file-path"
                value={newPath}
                onChange={(event) => {
                  setNewPath(event.target.value);
                  setCreateError(null);
                }}
                placeholder="src/new-file.js"
                autoComplete="off"
                spellCheck="false"
              />
              <div className="new-file-actions">
                <button
                  type="submit"
                  className="primary-button compact-button"
                  disabled={!newPath.trim()}
                >
                  Create draft
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setCreateOpen(false);
                    setCreateError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
              <p>
                The file is only created on the server when you save it with
                content.
              </p>
            </form>
          ) : null}

          {createError ? (
            <div className="inline-error file-inline-error" role="alert">
              <span>{createError}</span>
            </div>
          ) : null}

          <div className="file-tree-toolbar">
            <span>{showSearchResults ? "SEARCH RESULTS" : "EXPLORER"}</span>
            <button
              type="button"
              className={`filter-button compact-button${showIgnored ? " active" : ""}`}
              onClick={() => setShowIgnored((value) => !value)}
              aria-pressed={showIgnored}
            >
              Ignored
            </button>
          </div>

          <div className="file-tree-scroll">
            {!connected ? (
              <p className="file-tree-empty">
                Reconnect to browse project files.
              </p>
            ) : showSearchResults ? (
              searchState.status === "error" ? (
                <div className="file-tree-error">
                  <span>{searchState.error}</span>
                </div>
              ) : searchState.status === "loading" &&
                searchState.data.length === 0 ? (
                <p className="file-tree-empty">Searching…</p>
              ) : searchState.data.length === 0 ? (
                <p className="file-tree-empty">No matching files.</p>
              ) : (
                <ul className="file-search-results">
                  {searchState.data.map((path) => (
                    <li key={path}>
                      <button
                        type="button"
                        className="file-tree-row"
                        onClick={() => openFile(path)}
                        title={path}
                      >
                        <span className="file-tree-icon" aria-hidden="true">
                          ◇
                        </span>
                        <span className="file-tree-name">{path}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <TreeRows
                path="."
                depth={0}
                tree={tree}
                expanded={expanded}
                showIgnored={showIgnored}
                onToggle={toggleDirectory}
                onOpen={openFile}
              />
            )}
          </div>
        </aside>

        <section className="file-editor" aria-label="Code editor">
          {tabs.length > 0 ? (
            <div className="editor-tabs" role="tablist" aria-label="Open files">
              <button
                type="button"
                className="mobile-browse-button"
                onClick={() => setEditing(false)}
                aria-label="Show file explorer"
              >
                ☰
              </button>
              {tabs.map((tab) => (
                <div
                  key={tab.path}
                  className={`editor-tab${tab.path === activePath ? " active" : ""}`}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab.path === activePath}
                    onClick={() => {
                      setActivePath(tab.path);
                      setEditing(false);
                    }}
                    title={tab.path}
                  >
                    {tab.dirty ? (
                      <span className="dirty-dot" aria-label="Unsaved changes" />
                    ) : null}
                    {basename(tab.path)}
                  </button>
                  <button
                    type="button"
                    className="editor-tab-close"
                    onClick={() => closeTab(tab.path)}
                    aria-label={`Close ${basename(tab.path)}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {!activeTab ? (
            <div className="editor-empty">
              <div className="welcome-icon online">◇</div>
              <h2>Open a file to start.</h2>
              <p>
                Browse the project tree or search by name. Files stay on your
                local OpenCode server.
              </p>
            </div>
          ) : activeTab.status === "loading" ? (
            <div className="editor-loading" aria-label="Loading file">
              <span />
              <span />
              <span />
            </div>
          ) : activeTab.status === "error" ? (
            <div className="editor-empty">
              <h2>File unavailable.</h2>
              <p>{activeTab.error}</p>
              <div className="editor-empty-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={reloadActive}
                  disabled={!connected}
                >
                  Retry
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => closeTab(activeTab.path)}
                >
                  Close tab
                </button>
              </div>
            </div>
          ) : activeTab.type === "binary" ? (
            <div className="editor-empty">
              <h2>Binary file</h2>
              <p>
                {activeTab.path}
                {activeTab.mimeType ? ` · ${activeTab.mimeType}` : ""}
              </p>
              <p>Binary files are not editable in this mobile client.</p>
            </div>
          ) : (
            <div className="editor-shell">
              <div className="editor-header">
                <div className="editor-file-meta">
                  <strong>{basename(activeTab.path)}</strong>
                  <span title={activeTab.path}>{activeTab.path}</span>
                </div>
                <div className="editor-actions">
                  <span className="editor-language">
                    {fileLanguage(activeTab.path)}
                  </span>
                  {activeTab.isNew ? (
                    <span className="readonly-badge">UNSAVED</span>
                  ) : null}
                  {!canEditActive ? (
                    <span className="readonly-badge">READ ONLY</span>
                  ) : null}
                  {canEditActive ? (
                    <button
                      type="button"
                      className="secondary-button compact-button"
                      onClick={() => setEditing((value) => !value)}
                    >
                      {editing ? "Preview" : "Edit"}
                    </button>
                  ) : null}
                  {activeTab.dirty ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={reloadActive}
                      disabled={activeTab.saving}
                    >
                      Reload
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="primary-button compact-button"
                    onClick={saveActive}
                    disabled={saveDisabled}
                  >
                    {activeTab.saving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>

              {activeTab.saveError ? (
                <div className="inline-error editor-error" role="alert">
                  <span>{activeTab.saveError}</span>
                </div>
              ) : null}

              {activeTab.isNew && activeTab.content.length === 0 ? (
                <p className="editor-note">
                  Add content before saving. The server patch API cannot create
                  an empty file.
                </p>
              ) : null}

              {editing && canEditActive ? (
                <div className="code-editor">
                  <pre
                    ref={gutterRef}
                    className="line-numbers"
                    aria-hidden="true"
                  >
                    {Array.from(
                      { length: activeLines },
                      (_, index) => index + 1,
                    ).join("\n")}
                  </pre>
                  <textarea
                    ref={editorRef}
                    value={activeTab.content}
                    onChange={(event) => changeContent(event.target.value)}
                    onScroll={(event) => {
                      if (gutterRef.current) {
                        gutterRef.current.scrollTop =
                          event.currentTarget.scrollTop;
                      }
                    }}
                    onKeyDown={(event) => {
                      if (
                        (event.metaKey || event.ctrlKey) &&
                        event.key.toLowerCase() === "s"
                      ) {
                        event.preventDefault();
                        saveActive();
                      }
                    }}
                    wrap="off"
                    spellCheck="false"
                    autoCapitalize="off"
                    autoCorrect="off"
                    aria-label={`Edit ${activeTab.path}`}
                  />
                </div>
              ) : (
                <pre className="code-preview" tabIndex={0}>
                  <code>{activeTab.content}</code>
                </pre>
              )}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
