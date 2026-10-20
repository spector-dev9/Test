import { useEffect, useRef, useState } from "react";
import { connectionFailure } from "../lib/connection";
import { projectLabel } from "../lib/project";
import {
  createProjectSession,
  listProjectSessions,
  runProjectShell,
} from "../lib/opencode";
import {
  TERMINAL_SESSION_TITLE,
  appendTerminalLine,
  extractTerminalOutput,
  validateTerminalCommand,
} from "../lib/terminal";

function nextLine(line) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ...line,
  };
}

export function TerminalView({
  directory,
  connected,
  project,
  active,
  agent,
}) {
  const [lines, setLines] = useState([]);
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sessionID, setSessionID] = useState(null);
  const outputRef = useRef(null);
  const mountedRef = useRef(true);
  const historyRef = useRef([]);
  const historyPositionRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const output = outputRef.current;
    if (output) output.scrollTop = output.scrollHeight;
  }, [active, lines, busy]);

  function addLine(line) {
    setLines((previous) => appendTerminalLine(previous, nextLine(line)));
  }

  async function ensureSession() {
    if (sessionID) return sessionID;

    const sessions = await listProjectSessions(directory);
    const existing = sessions
      .filter(
        (session) =>
          session?.title === TERMINAL_SESSION_TITLE &&
          !session.time?.archived,
      )
      .sort(
        (left, right) =>
          (right.time?.updated ?? 0) - (left.time?.updated ?? 0),
      )[0];

    if (existing?.id) {
      setSessionID(existing.id);
      return existing.id;
    }

    const created = await createProjectSession(directory, {
      title: TERMINAL_SESSION_TITLE,
    });
    setSessionID(created.id);
    return created.id;
  }

  async function submit(event) {
    event.preventDefault();

    const normalized = validateTerminalCommand(command);
    if (!normalized || busy || !connected) return;

    setCommand("");
    setError(null);
    setBusy(true);

    historyRef.current = [...historyRef.current, normalized].slice(-100);
    historyPositionRef.current = historyRef.current.length;

    addLine({ kind: "command", text: normalized });

    try {
      const id = await ensureSession();
      const result = await runProjectShell(directory, id, {
        command: normalized,
        agent: agent || "build",
      });
      if (!mountedRef.current) return;

      const { output, failed } = extractTerminalOutput(result);
      if (output) {
        addLine({ kind: failed ? "error" : "output", text: output });
      } else if (!failed) {
        addLine({ kind: "system", text: "(no output)" });
      }
    } catch (failure) {
      if (!mountedRef.current) return;

      setError(
        connectionFailure(
          failure,
          "The command could not be run.",
        ).message,
      );
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  function handleHistory(event) {
    if (event.key === "ArrowUp") {
      if (historyRef.current.length === 0) return;
      event.preventDefault();
      historyPositionRef.current = Math.max(
        0,
        historyPositionRef.current - 1,
      );
      setCommand(historyRef.current[historyPositionRef.current] ?? "");
      return;
    }

    if (event.key === "ArrowDown") {
      if (historyPositionRef.current >= historyRef.current.length) return;
      event.preventDefault();
      historyPositionRef.current += 1;
      setCommand(
        historyPositionRef.current === historyRef.current.length
          ? ""
          : historyRef.current[historyPositionRef.current] ?? "",
      );
    }
  }

  return (
    <section className="terminal-view" aria-labelledby="terminal-heading">
      <header className="terminal-toolbar">
        <div className="terminal-heading">
          <span className="panel-kicker">PROJECT SHELL</span>
          <h1 id="terminal-heading">
            Terminal
            <span className="terminal-project">
              {project ? projectLabel(project) : ""}
            </span>
          </h1>
        </div>
        <button
          type="button"
          className="secondary-button compact-button"
          onClick={() => {
            setLines([]);
            setError(null);
          }}
          disabled={lines.length === 0 || busy}
        >
          Clear
        </button>
      </header>

      <div className="terminal-panel">
        <div
          ref={outputRef}
          className="terminal-screen"
          role="log"
          aria-live="polite"
          aria-label="Terminal output"
        >
          {lines.length === 0 ? (
            <div className="terminal-empty">
              <p>Run a command in this project.</p>
              <small>
                Commands run through the local OpenCode server, not a full
                interactive PTY.
              </small>
            </div>
          ) : (
            lines.map((line) => (
              <div
                key={line.id}
                className={`terminal-line terminal-line-${line.kind}`}
              >
                {line.kind === "command" ? (
                  <span className="terminal-command-prompt" aria-hidden="true">
                    $
                  </span>
                ) : null}
                <pre>{line.text}</pre>
              </div>
            ))
          )}
          {busy ? (
            <div className="terminal-line terminal-line-pending">
              <span className="terminal-spinner" aria-hidden="true" />
              <span>Running…</span>
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="inline-error terminal-error" role="alert">
            <span>{error}</span>
          </div>
        ) : null}

        <form className="terminal-input-row" onSubmit={submit}>
          <span className="terminal-command-prompt" aria-hidden="true">
            $
          </span>
          <input
            type="text"
            value={command}
            onChange={(event) => {
              setCommand(event.target.value);
              setError(null);
            }}
            onKeyDown={handleHistory}
            placeholder={
              connected ? "Enter a shell command" : "Connect to run commands"
            }
            aria-label="Shell command"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck="false"
            enterKeyHint="send"
            disabled={!connected}
          />
          <button
            type="submit"
            className="primary-button compact-button"
            disabled={!connected || busy || !command.trim()}
          >
            {busy ? "Running…" : "Run"}
          </button>
        </form>
      </div>

      <p className="terminal-note">
        Runs in {project ? projectLabel(project) : "this project"} through the
        OpenCode server. Commands are saved in a dedicated terminal session
        {sessionID ? ` (${sessionID.slice(0, 12)}…)` : ""}.
      </p>
    </section>
  );
}
