import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  DEFAULT_OPENCODE_URL,
  connectionFailure,
} from "../lib/connection";
import {
  createProjectTerminal,
  removeProjectTerminal,
  resizeProjectTerminal,
} from "../lib/opencode";
import { ptyWebSocketUrl, validateTerminalSize } from "../lib/pty";
import { openPtySocket } from "../lib/ptySocket";
import { projectLabel } from "../lib/project";

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

export function TerminalView({ directory, connected, project, active }) {
  const [enabled, setEnabled] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState("connecting");
  const [error, setError] = useState(null);
  const terminalTitle = project
    ? `${projectLabel(project)} terminal`
    : "OpenCode Terminal";
  const containerRef = useRef(null);
  const terminalRef = useRef(null);
  const fitRef = useRef(null);
  const socketRef = useRef(null);
  const ptyRef = useRef(null);
  const resizeTimerRef = useRef(null);
  const activeRef = useRef(active);
  const directoryRef = useRef(directory);

  useEffect(() => {
    activeRef.current = active;
    directoryRef.current = directory;
  }, [active, directory]);

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
      fontSize: 13,
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

    const dataSubscription = terminal.onData((data) => {
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
  }, []);

  useEffect(() => {
    if (!enabled || !connected) return undefined;

    const terminal = terminalRef.current;
    let cancelled = false;

    function teardown(socket, pty, remove) {
      if (socketRef.current === socket) socketRef.current = null;
      if (socket) socket.close();

      if (ptyRef.current === pty) ptyRef.current = null;
      if (pty && remove) {
        removeProjectTerminal(directory, pty.id).catch(() => {});
      }
    }

    async function connect(pty) {
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
        removeProjectTerminal(directory, pty.id).catch(() => {});
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
        removeProjectTerminal(directory, pty.id).catch(() => {});
        setError("The terminal connection could not be established.");
        setStatus("error");
        return;
      }

      if (cancelled) {
        connection.close();
        return;
      }

      socketRef.current = connection;
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

      try {
        const pty = await createProjectTerminal(directory, {
          title: terminalTitle,
        });

        if (cancelled) {
          removeProjectTerminal(directory, pty.id).catch(() => {});
          return;
        }

        ptyRef.current = pty;
        connect(pty);
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
      teardown(socketRef.current, ptyRef.current, true);
    };
  }, [attempt, connected, directory, enabled, terminalTitle]);

  function reconnect() {
    setError(null);
    setStatus("connecting");
    setAttempt((value) => value + 1);
  }

  function clearTerminal() {
    terminalRef.current?.clear();
    terminalRef.current?.scrollToBottom();
  }

  const visibleStatus = !enabled
    ? "idle"
    : !connected
      ? "offline"
      : status;
  const controlsDisabled =
    !connected || visibleStatus === "connecting";

  return (
    <section className="terminal-view" aria-labelledby="terminal-heading">
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
        </div>
      </header>

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
      </div>

      <p className="terminal-note">
        Tap the terminal and type to use the interactive shell in{" "}
        {project ? projectLabel(project) : "this project"}. Closing this tab
        keeps the session running.
      </p>
    </section>
  );
}
