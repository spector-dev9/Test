import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  DEFAULT_OPENCODE_URL,
  connectionFailure,
} from "../lib/connection";
import {
  createProjectTerminal,
  listProjectTerminals,
  removeProjectTerminal,
  resizeProjectTerminal,
} from "../lib/opencode";
import { ptyWebSocketUrl, validateTerminalSize } from "../lib/pty";
import { openPtySocket } from "../lib/ptySocket";
import { projectLabel } from "../lib/project";
import {
  ensureLinuxEnvironment,
  isLinuxEnvironmentSupported,
  isLinuxEnvironmentReady,
  linuxGuestShell,
  runLinuxCommand,
} from "../lib/linuxEnvironment.js";
import { readUiPrefs } from "../lib/uiPrefs.js";
import { commandHint, commandOutcome } from "../lib/shell.js";
import { copyText } from "../lib/clipboard";

const RESIZE_DEBOUNCE_MS = 220;

const TERMINAL_THEME = {
  background: "#0d0e18",
  foreground: "#e7e4ff",
  cursor: "#c084fc",
  cursorAccent: "#0d0e18",
  selectionBackground: "#40365f",
  black: "#1b1c2b",
  red: "#f08b9d",
  green: "#68d6a4",
  yellow: "#e6b86b",
  blue: "#93b4f5",
  magenta: "#d3a1f5",
  cyan: "#7fd8dc",
  white: "#e7e4ff",
  brightBlack: "#77758f",
  brightRed: "#ffadba",
  brightGreen: "#94e8bf",
  brightYellow: "#f2d394",
  brightBlue: "#b8ccff",
  brightMagenta: "#e8c1ff",
  brightCyan: "#a5ecef",
  brightWhite: "#fbfaff",
};

const STATUS_LABELS = {
  idle: "Manual",
  connecting: "Starting shell…",
  live: "Live",
  closed: "Session ended",
  error: "Unavailable",
  offline: "Server offline",
};

function statusLabel(status) {
  return STATUS_LABELS[status] ?? STATUS_LABELS.idle;
}

const MAX_HISTORY = 200;
const MAX_TRACKED_LINE = 400;

function trackTerminalInput(data, bufferRef, pushHistory) {
  let buffer = bufferRef.current ?? "";

  for (let i = 0; i < data.length; i += 1) {
    const char = data[i];

    if (char === "\x1b") {
      const next = data[i + 1];
      if (next === "[") {
        i += 2;
        while (i < data.length && !/[@-~]/.test(data[i])) i += 1;
      } else if (next === "O") {
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    if (char === "\r" || char === "\n") {
      pushHistory(buffer);
      buffer = "";
      continue;
    }

    if (char === "\x7f" || char === "\b") {
      buffer = buffer.slice(0, -1);
      continue;
    }

    if (char === "\x03") {
      buffer = "";
      continue;
    }

    if (char >= " " && char !== "\x7f") {
      buffer += char;
      if (buffer.length > MAX_TRACKED_LINE) {
        buffer = buffer.slice(-MAX_TRACKED_LINE);
      }
    }
  }

  bufferRef.current = buffer;
}

function extractTerminalText(terminal) {
  if (!terminal) return "";

  const selection = terminal.getSelection();
  if (selection && selection.trim()) return selection;

  const buffer = terminal.buffer.active;
  const rows = [];

  for (let i = 0; i < buffer.length; i += 1) {
    const line = buffer.getLine(i);
    if (!line) continue;
    rows.push(line.translateToString(true).replace(/\s+$/, ""));
  }

  while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();

  return rows.join("\n");
}

export function TerminalView({
  directory,
  connected,
  project,
  active,
  intent,
  terminalFontSize,
}) {
  const [enabled, setEnabled] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState("connecting");
  const [error, setError] = useState(null);
  const [terminalCopied, setTerminalCopied] = useState(false);
  const [terminalCopyError, setTerminalCopyError] = useState("");
  const [terminalReady, setTerminalReady] = useState(false);
  const [linuxSupported, setLinuxSupported] = useState(false);
  const [linuxReady, setLinuxReady] = useState(false);
  const [linuxPreparing, setLinuxPreparing] = useState(false);
  const [shellError, setShellError] = useState("");
  const [linuxError, setLinuxError] = useState("");
  const [linuxOutput, setLinuxOutput] = useState("");
  const [linuxCommand, setLinuxCommand] = useState("");
  const [linuxRunning, setLinuxRunning] = useState(false);
  const [showLinux, setShowLinux] = useState(false);
  const [shellMode, setShellMode] = useState("host");
  const [sessions, setSessions] = useState([]);
  const [activePtyId, setActivePtyId] = useState(null);
  const [attachedId, setAttachedId] = useState(null);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [linuxHistoryIndex, setLinuxHistoryIndex] = useState(-1);
  const [fullscreen, setFullscreen] = useState(false);
  const terminalTitle = project
    ? `${projectLabel(project)} terminal`
    : "OpenCode Terminal";
  const containerRef = useRef(null);
  const terminalRef = useRef(null);
  const fitRef = useRef(null);
  const socketRef = useRef(null);
  const ptyRef = useRef(null);
  const sessionsRef = useRef([]);
  const lineBufferRef = useRef("");
  const linuxDraftRef = useRef("");
  const resizeTimerRef = useRef(null);
  const activeRef = useRef(active);
  const directoryRef = useRef(directory);
  const pendingCommandRef = useRef(null);
  const intentNonceRef = useRef(null);

  useEffect(() => {
    activeRef.current = active;
    directoryRef.current = directory;
    sessionsRef.current = sessions;
  }, [active, directory, sessions]);

  useEffect(() => {
    if (!intent?.command || !intent.nonce) return;
    if (intent.nonce === intentNonceRef.current) return;

    intentNonceRef.current = intent.nonce;
    pendingCommandRef.current = String(intent.command);
  }, [intent?.command, intent?.nonce]);

  useEffect(() => {
    const command = pendingCommandRef.current;
    if (status !== "live" || !command) return;

    pendingCommandRef.current = null;
    terminalRef.current?.input(`${command}\r`, true);
  }, [intent, status]);

  const pushHistory = useCallback((command) => {
    const normalized = typeof command === "string" ? command.trim() : "";
    if (!normalized) return;

    setHistory((previous) => {
      if (previous[0] === normalized) return previous;

      const next = [
        normalized,
        ...previous.filter((entry) => entry !== normalized),
      ];

      return next.length > MAX_HISTORY ? next.slice(0, MAX_HISTORY) : next;
    });
  }, []);

  useEffect(() => {
    if (!connected) return undefined;

    let cancelled = false;

    listProjectTerminals(directory)
      .then((list) => {
        if (cancelled) return;
        setSessions(list);
        setActivePtyId((previous) =>
          previous && !list.some((entry) => entry.id === previous)
            ? null
            : previous,
        );
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [attempt, connected, directory]);

  useEffect(() => {
    if (!fullscreen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") setFullscreen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  useEffect(() => {
    if (!active) terminalRef.current?.blur();
    if (!active) return undefined;

    const frame = window.requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
      } catch {
        // The terminal may not be measurable while the tab is changing.
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const terminal = new Terminal({
      allowTransparency: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, "Cascadia Mono", monospace',
      fontSize: readUiPrefs().terminalFontSize,
      lineHeight: 1.2,
      scrollback: 5000,
      smoothScrollDuration: 0,
      theme: TERMINAL_THEME,
    });
    const fit = new FitAddon();

    terminal.loadAddon(fit);
    terminal.open(container);
    terminalRef.current = terminal;
    fitRef.current = fit;
    setTerminalReady(true);

    const dataSubscription = terminal.onData((data) => {
      trackTerminalInput(data, lineBufferRef, pushHistory);
      socketRef.current?.send(data);
    });
    const resizeSubscription = terminal.onResize(({ cols, rows }) => {
      window.clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = window.setTimeout(() => {
        const pty = ptyRef.current;
        const size = validateTerminalSize(cols, rows);

        if (!pty || !size) return;

        resizeProjectTerminal(directoryRef.current, pty.id, size).catch(
          () => {},
        );
      }, RESIZE_DEBOUNCE_MS);
    });
    const fitTerminal = () => {
      if (!activeRef.current) return;

      try {
        fit.fit();
      } catch {
        // Keep the last usable size when layout is temporarily unavailable.
      }
    };
    const resizeObserver = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;

      if ((box?.width ?? 0) > 0 && (box?.height ?? 0) > 0) {
        setEnabled(true);
      }

      fitTerminal();
    });

    resizeObserver.observe(container);
    window.visualViewport?.addEventListener("resize", fitTerminal);

    return () => {
      window.clearTimeout(resizeTimerRef.current);
      resizeObserver.disconnect();
      window.visualViewport?.removeEventListener("resize", fitTerminal);
      dataSubscription.dispose();
      resizeSubscription.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [pushHistory]);

  useEffect(() => {
    const terminal = terminalRef.current;
    const size = Number.isFinite(terminalFontSize) ? terminalFontSize : 13;
    if (!terminal || terminal.options.fontSize === size) return;

    terminal.options.fontSize = size;
    try {
      fitRef.current?.fit();
    } catch {
      // The terminal may not be measurable during a layout change.
    }
  }, [terminalFontSize]);

  const checkLinux = useCallback(async () => {
    if (!isLinuxEnvironmentSupported()) {
      setLinuxSupported(false);
      setLinuxReady(false);
      return;
    }

    setLinuxSupported(true);

    try {
      const ready = await isLinuxEnvironmentReady();
      setLinuxReady(Boolean(ready?.ready));
      setLinuxError(
        ready?.ready
          ? ""
          : ready?.reason || "The Alpine environment is not prepared yet.",
      );
    } catch (failure) {
      setLinuxReady(false);
      setLinuxError(
        failure?.message || "The Linux environment status is unavailable.",
      );
    }
  }, []);

  useEffect(() => {
    checkLinux();
  }, [checkLinux]);

  // The terminal stays mounted while other views are open, so the readiness
  // state has to be refreshed when the view or the Linux panel is used.
  useEffect(() => {
    if (active) checkLinux();
  }, [active, checkLinux]);

  useEffect(() => {
    if (showLinux) checkLinux();
  }, [checkLinux, showLinux]);

  async function prepareLinux() {
    if (linuxPreparing) return;

    setLinuxPreparing(true);
    setLinuxError("");

    try {
      const result = await ensureLinuxEnvironment();
      await checkLinux();
      setLinuxOutput(
        (previous) =>
          previous +
          "Alpine environment prepared.\n" +
          (result?.nodeReady === false
            ? "Node.js could not be installed automatically; run apk add nodejs npm.\n"
            : ""),
      );
    } catch (failure) {
      setLinuxError(
        failure?.message || "The Linux environment could not be prepared.",
      );
    } finally {
      setLinuxPreparing(false);
    }
  }

  const resolveShellOptions = useCallback(async () => {
    if (shellMode !== "alpine") return { options: {} };

    try {
      const shell = await linuxGuestShell(directory);

      if (!shell.command || shell.args.length === 0) {
        throw new Error("The Alpine shell could not be prepared.");
      }

      setShellError("");
      return {
        options: {
          command: shell.command,
          args: [...shell.args, "/bin/ash"],
          cwd: shell.cwd || directory,
          env: shell.env,
        },
      };
    } catch (failure) {
      const message =
        failure?.message || "The Alpine shell could not be started.";
      setShellError(message);
      return { options: null, error: message };
    }
  }, [directory, shellMode]);

  const changeShellMode = useCallback((mode) => {
    setShellMode((current) => (current === mode ? current : mode));
    setShellError("");
    // A different shell needs its own session.
    setActivePtyId(null);
  }, []);

  useEffect(() => {
    if (!enabled || !connected) return undefined;

    const terminal = terminalRef.current;
    let cancelled = false;

    function teardown(socket, pty) {
      if (socketRef.current === socket) socketRef.current = null;
      if (socket) socket.close();

      if (ptyRef.current === pty) ptyRef.current = null;
      setAttachedId((previous) => (previous === pty?.id ? null : previous));
    }

    async function connect(pty, own) {
      let url;

      try {
        url = ptyWebSocketUrl(
          DEFAULT_OPENCODE_URL,
          directory,
          pty.id,
          0,
        );
      } catch {
        ptyRef.current = null;
        if (own) removeProjectTerminal(directory, pty.id).catch(() => {});
        setError("The terminal connection could not be opened.");
        setStatus("error");
        return;
      }

      let connection;
      let closed = false;

      try {
        connection = await openPtySocket(url, {
          onMessage(text) {
            if (cancelled || closed) return;
            terminal?.write(text);
          },
          onError(failure) {
            if (cancelled || closed) return;
            setError(
              failure?.message ||
                "The terminal connection was interrupted.",
            );
          },
          onClose() {
            if (cancelled || closed) return;

            closed = true;
            if (socketRef.current === connection) socketRef.current = null;
            ptyRef.current = null;
            setAttachedId((previous) =>
              previous === pty.id ? null : previous,
            );
            setStatus("closed");
            setError(null);
            terminal?.write(
              "\r\n\x1b[90m[terminal session closed]\x1b[0m\r\n",
            );
          },
        });
      } catch {
        if (cancelled) return;

        ptyRef.current = null;
        if (own) removeProjectTerminal(directory, pty.id).catch(() => {});
        setError("The terminal connection could not be established.");
        setStatus("error");
        return;
      }

      if (cancelled) {
        connection.close();
        return;
      }

      socketRef.current = connection;
      setAttachedId(pty.id);
      setStatus("live");
      setError(null);

      window.setTimeout(() => {
        const current = ptyRef.current;
        const size = validateTerminalSize(
          terminal?.cols ?? 0,
          terminal?.rows ?? 0,
        );

        if (!current || !size || cancelled) return;
        resizeProjectTerminal(directory, current.id, size).catch(() => {});
      }, 0);
    }

    async function start() {
      await Promise.resolve();
      if (cancelled) return;

      setStatus("connecting");
      setError(null);
      terminal?.reset();

      const target = activePtyId
        ? sessionsRef.current.find((entry) => entry.id === activePtyId)
        : null;

      if (target) {
        ptyRef.current = target;
        connect(target, false);
        return;
      }

      if (activePtyId) setActivePtyId(null);

      try {
        const { options, error: shellFailure } = await resolveShellOptions();

        if (options === null) {
          setStatus("error");
          setError(shellFailure || "The Alpine shell could not be started.");
          return;
        }

        const pty = await createProjectTerminal(directory, {
          title: terminalTitle,
          ...options,
        });

        if (cancelled) {
          removeProjectTerminal(directory, pty.id).catch(() => {});
          return;
        }

        ptyRef.current = pty;
        setSessions((previous) =>
          previous.some((entry) => entry.id === pty.id)
            ? previous
            : [...previous, pty],
        );
        connect(pty, true);
      } catch (failure) {
        if (cancelled) return;

        setStatus("error");
        setError(
          connectionFailure(
            failure,
            "The terminal could not be started.",
          ).message,
        );
      }
    }

    start();

    return () => {
      cancelled = true;
      teardown(socketRef.current, ptyRef.current);
    };
  }, [
    activePtyId,
    attempt,
    connected,
    directory,
    enabled,
    resolveShellOptions,
    terminalTitle,
  ]);

  function reconnect() {
    setError(null);
    setStatus("connecting");
    setAttempt((value) => value + 1);
  }

  async function copyTerminalOutput() {
    const text = extractTerminalText(terminalRef.current);
    if (!text.trim()) {
      setTerminalCopyError("There is no terminal output to copy yet.");
      return;
    }

    try {
      await copyText(text);
      setTerminalCopyError("");
      setTerminalCopied(true);
      setTimeout(() => setTerminalCopied(false), 1500);
    } catch {
      setTerminalCopied(false);
      setTerminalCopyError(
        "The terminal output could not be copied. Select the text and copy it manually.",
      );
    }
  }

  function clearTerminal() {
    terminalRef.current?.clear();
    terminalRef.current?.scrollToBottom();
  }

  function newSession() {
    setShowHistory(false);
    if (activePtyId === null) {
      setAttempt((value) => value + 1);
      return;
    }
    setActivePtyId(null);
  }

  function attachSession(session) {
    if (session.id === attachedId) return;
    setShowHistory(false);
    setActivePtyId(session.id);
  }

  async function closeSession(session) {
    setSessions((previous) =>
      previous.filter((entry) => entry.id !== session.id),
    );

    if (attachedId === session.id) {
      if (activePtyId === session.id) setActivePtyId(null);
      else setAttempt((value) => value + 1);
    }

    removeProjectTerminal(directory, session.id).catch(() => {});
  }

  function sendHistoryCommand(command) {
    setShowHistory(false);
    if (status !== "live" || !command) return;

    terminalRef.current?.input(`${command}\r`, true);
    pushHistory(command);
  }

  function toggleFullscreen() {
    const next = !fullscreen;
    setFullscreen(next);
    if (next) {
      requestAnimationFrame(() => terminalRef.current?.focus());
    }
  }


  async function runLinux() {
    if (!linuxCommand.trim() || linuxRunning) return;
    const command = linuxCommand;
    pushHistory(command);
    setLinuxHistoryIndex(-1);
    setLinuxRunning(true);
    try {
      const result = await runLinuxCommand(command, directory);
      const outcome = commandOutcome(result);
      const hint = commandHint(command, outcome.output);
      const elapsed =
        outcome.durationMs === null ? "" : ` (${outcome.durationMs} ms)`;
      setLinuxOutput((previous) =>
        previous +
          `$ ${command}\n${outcome.output}\n` +
          `[${outcome.label}${elapsed}]\n` +
          (hint ? `Hint: ${hint}\n` : "")
      );
      if (outcome.ok) setLinuxCommand("");
    } catch (failure) {
      setLinuxOutput((previous) =>
        previous + `$ ${command}\nError: ${failure.message}\n`
      );
    } finally {
      setLinuxRunning(false);
    }
  }

  const visibleStatus = !enabled
    ? "idle"
    : !connected
      ? "offline"
      : status;
  const controlsDisabled =
    !connected || visibleStatus === "connecting";

  return (
    <section
      className={`terminal-view${fullscreen ? " terminal-fullscreen" : ""}`}
      aria-labelledby="terminal-heading"
    >
      <header className="terminal-toolbar">
        <div className="terminal-heading">
          <span className="panel-kicker">PROJECT PTY</span>
          <h1 id="terminal-heading">
            Terminal
            <span className="terminal-project">
              {project ? projectLabel(project) : ""}
            </span>
          </h1>
        </div>
        <div className="terminal-actions">
          <span
            className={`terminal-status terminal-status-${visibleStatus}`}
            title={statusLabel(visibleStatus)}
          >
            <span className="terminal-status-dot" aria-hidden="true" />
            <span className="terminal-status-label">
              {statusLabel(visibleStatus)}
            </span>
          </span>
          <button
            type="button"
            className="secondary-button compact-button"
            onClick={reconnect}
            disabled={controlsDisabled}
          >
            Reconnect
          </button>
          <button
            type="button"
            className="secondary-button compact-button"
            onClick={clearTerminal}
          >
            Clear
          </button>
          <button
            type="button"
            className="copy-button terminal-copy"
            onClick={copyTerminalOutput}
            disabled={!terminalReady}
            title={terminalCopied ? "Copied" : "Copy terminal output"}
            aria-label={terminalCopied ? "Copied" : "Copy terminal output"}
          >
            {terminalCopied ? "Copied" : "Copy output"}
          </button>
          <button
            type="button"
            className={`secondary-button compact-button${showHistory ? " active" : ""}`}
            onClick={() => setShowHistory((value) => !value)}
            aria-expanded={showHistory}
            aria-controls="terminal-history-panel"
            title="Command history"
          >
            History
            {history.length > 0 ? (
              <span className="history-count" aria-hidden="true">
                {history.length}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            className="secondary-button compact-button"
            onClick={toggleFullscreen}
            aria-pressed={fullscreen}
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen terminal"}
          >
            {fullscreen ? "Exit" : "Expand"}
          </button>
          {linuxSupported ? (
            <div
              className="shell-mode-switch"
              role="group"
              aria-label="Terminal shell"
            >
              <button
                type="button"
                className={`shell-mode-option${shellMode === "host" ? " active" : ""}`}
                aria-pressed={shellMode === "host"}
                onClick={() => changeShellMode("host")}
                title="Run commands in the app sandbox"
              >
                Host
              </button>
              <button
                type="button"
                className={`shell-mode-option${shellMode === "alpine" ? " active" : ""}`}
                aria-pressed={shellMode === "alpine"}
                onClick={() => changeShellMode("alpine")}
                title="Run commands in the bundled Alpine environment"
              >
                Alpine
              </button>
            </div>
          ) : null}
          {linuxSupported && (
            <button
              type="button"
              className="secondary-button compact-button"
              onClick={() => setShowLinux((prev) => !prev)}
              title={showLinux ? "Hide Linux shell" : "Show Linux shell"}
              aria-label={showLinux ? "Hide Linux shell" : "Show Linux shell"}
            >
              {showLinux ? "Hide Linux" : "Linux"}
            </button>
          )}
        </div>
      </header>

      {sessions.length > 0 ? (
        <div
          className="terminal-sessions"
          role="group"
          aria-label="Terminal sessions"
        >
          {sessions.map((session) => {
            const isSelected =
              session.id === activePtyId || session.id === attachedId;

            return (
              <div
                key={session.id}
                className={`terminal-session${isSelected ? " active" : ""}`}
              >
                <button
                  type="button"
                  className="terminal-session-tab"
                  onClick={() => attachSession(session)}
                  aria-pressed={isSelected}
                  title={`${session.command} · ${session.status}`}
                >
                  <span
                    className={`session-dot session-dot-${session.status}`}
                    aria-hidden="true"
                  />
                  <span className="terminal-session-title">{session.title}</span>
                </button>
                <button
                  type="button"
                  className="terminal-session-close"
                  onClick={() => closeSession(session)}
                  aria-label={`Close session ${session.title}`}
                >
                  ×
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className="secondary-button compact-button terminal-session-new"
            onClick={newSession}
            disabled={controlsDisabled}
          >
            + New
          </button>
        </div>
      ) : null}

      {showHistory ? (
        <div
          className="terminal-history"
          id="terminal-history-panel"
          role="region"
          aria-label="Command history"
        >
          <div className="terminal-history-head">
            <span className="panel-kicker">COMMAND HISTORY</span>
            <button
              type="button"
              className="text-button"
              onClick={() => setHistory([])}
              disabled={history.length === 0}
            >
              Clear
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setShowHistory(false)}
              aria-label="Close command history"
            >
              Close
            </button>
          </div>
          {history.length === 0 ? (
            <p className="panel-note">
              Commands you run in the terminal or Linux shell appear here.
            </p>
          ) : (
            <ul className="terminal-history-list">
              {history.map((command, index) => (
                <li key={`${index}-${command}`}>
                  <button
                    type="button"
                    onClick={() => sendHistoryCommand(command)}
                    title="Run this command again"
                  >
                    <code>{command}</code>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="terminal-panel">
        <div
          ref={containerRef}
          className="terminal-xterm"
          aria-label="Interactive terminal"
        />

        {error && connected ? (
          <div className="inline-error terminal-error" role="alert">
            <span>{error}</span>
          </div>
        ) : null}

        {shellMode === "alpine" && shellError ? (
          <div className="inline-error terminal-error" role="alert">
            <span>{shellError}</span>
          </div>
        ) : null}

        {terminalCopyError ? (
          <div className="inline-error terminal-error" role="alert">
            <span>{terminalCopyError}</span>
          </div>
        ) : null}

        {showLinux && linuxSupported && (
          <div className="linux-runner">
            <div className="linux-runner-head">
              <span className="panel-kicker">LINUX SHELL</span>
              <span className="linux-status">
                {linuxReady ? "ready" : "not ready"}
              </span>
            </div>
            <p className="linux-note">
              Alpine aarch64 under PRoot. Commands run in{" "}
              <code>{directory}</code> with the same files the agent edits.
              Commands are case-sensitive, and this is Alpine: use{" "}
              <code>apk</code>, not <code>apt</code> or <code>pkg</code>.
            </p>
            <pre className="linux-output">{linuxOutput}</pre>
            <div className="linux-input">
              <input
                className="linux-input-field"
                value={linuxCommand}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                onChange={(event) => {
                  setLinuxCommand(event.target.value);
                  if (linuxHistoryIndex !== -1) setLinuxHistoryIndex(-1);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    runLinux();
                    return;
                  }

                  if (event.key === "ArrowUp") {
                    if (history.length === 0) return;
                    event.preventDefault();
                    if (linuxHistoryIndex === -1) {
                      linuxDraftRef.current = linuxCommand;
                    }
                    const next =
                      linuxHistoryIndex === -1
                        ? 0
                        : Math.min(
                            linuxHistoryIndex + 1,
                            history.length - 1,
                          );
                    setLinuxHistoryIndex(next);
                    setLinuxCommand(history[next]);
                    return;
                  }

                  if (event.key === "ArrowDown") {
                    if (linuxHistoryIndex === -1) return;
                    event.preventDefault();
                    const next = linuxHistoryIndex - 1;
                    setLinuxHistoryIndex(next);
                    setLinuxCommand(
                      next === -1 ? linuxDraftRef.current : history[next],
                    );
                  }
                }}
                placeholder="apk add python3"
                aria-label="Linux shell command"
                disabled={!linuxReady || linuxRunning}
              />
              <button
                type="button"
                className="secondary-button compact-button"
                onClick={runLinux}
                disabled={!linuxReady || linuxRunning || !linuxCommand.trim()}
              >
                {linuxRunning ? "Running…" : "Run"}
              </button>
              {!linuxReady ? (
                <div className="linux-not-ready">
                  <span className="linux-note">
                    {linuxError ||
                      "The Alpine environment is not prepared yet."}
                  </span>
                  <button
                    type="button"
                    className="secondary-button compact-button"
                    onClick={prepareLinux}
                    disabled={linuxPreparing}
                  >
                    {linuxPreparing ? "Preparing…" : "Prepare Linux"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>

      <p className="terminal-note">
        Tap the terminal and type to use the interactive shell in{" "}
        {project ? projectLabel(project) : "this project"}. Closing this tab
        keeps the session running.
      </p>
    </section>
  );
}
