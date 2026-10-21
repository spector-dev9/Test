import { useCallback, useEffect, useRef, useState } from "react";
import { Browser } from "@capacitor/browser";
import {
  canEmbedPreview,
  parsePreviewUrl,
  readStoredPreviewCommand,
  readStoredPreviewUrl,
  storePreviewCommand,
  storePreviewUrl,
} from "../lib/preview";

const LOAD_TIMEOUT_MS = 12000;

export function PreviewView({ connected, active, onRunInTerminal }) {
  const [input, setInput] = useState(() => readStoredPreviewUrl() ?? "");
  const [command, setCommand] = useState(
    () => readStoredPreviewCommand() ?? "",
  );
  const [frameUrl, setFrameUrl] = useState(null);
  const [phase, setPhase] = useState("idle");
  const [notice, setNotice] = useState(null);
  const [frameKey, setFrameKey] = useState(0);
  const timerRef = useRef(null);
  const autoLoadedRef = useRef(false);

  const clearLoadTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const load = useCallback(
    (raw) => {
      const parsed = parsePreviewUrl(raw);

      if (!parsed.ok) {
        setNotice(parsed.error);
        return;
      }

      setInput(parsed.url);
      storePreviewUrl(parsed.url);
      setNotice(null);

      if (!canEmbedPreview(parsed.url)) {
        clearLoadTimer();
        setFrameUrl(null);
        setPhase("blocked");
        return;
      }

      setFrameUrl(parsed.url);
      setPhase("loading");
      setFrameKey((value) => value + 1);

      clearLoadTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setPhase((current) => (current === "loading" ? "timeout" : current));
        setNotice("The preview did not respond in time.");
      }, LOAD_TIMEOUT_MS);
    },
    [clearLoadTimer],
  );

  const handleFrameLoad = useCallback(() => {
    clearLoadTimer();
    setPhase("ready");
    setNotice(null);
  }, [clearLoadTimer]);

  const openExternal = useCallback(async () => {
    const target = frameUrl ?? parsePreviewUrl(input).url;
    if (!target) return;

    try {
      await Browser.open({ url: target });
    } catch {
      setNotice("The browser could not open this address.");
    }
  }, [frameUrl, input]);

  useEffect(() => () => clearLoadTimer(), [clearLoadTimer]);

  useEffect(() => {
    if (!active || autoLoadedRef.current) return undefined;

    const stored = readStoredPreviewUrl();
    if (!stored) {
      autoLoadedRef.current = true;
      return undefined;
    }

    const timer = window.setTimeout(() => {
      autoLoadedRef.current = true;
      load(stored);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [active, load]);

  function submitUrl(event) {
    event.preventDefault();
    load(input);
  }

  function submitCommand(event) {
    event.preventDefault();
    const trimmed = command.trim();
    if (!trimmed) return;
    storePreviewCommand(trimmed);
    onRunInTerminal(trimmed);
  }

  const frameVisible = Boolean(frameUrl) && phase !== "blocked";

  return (
    <section className="preview-view" aria-labelledby="preview-heading">
      <header className="preview-toolbar">
        <div className="preview-heading">
          <span className="panel-kicker">LOCAL PREVIEW</span>
          <h1 id="preview-heading">Preview</h1>
        </div>
        <div className="preview-actions">
          <button
            type="button"
            className="secondary-button compact-button"
            onClick={() => frameUrl && load(frameUrl)}
            disabled={!frameUrl || phase === "loading"}
            title="Reload the preview"
          >
            Reload
          </button>
          <button
            type="button"
            className="secondary-button compact-button"
            onClick={openExternal}
            disabled={!frameUrl && !parsePreviewUrl(input).ok}
            title="Open this address in the system browser"
          >
            Open in browser
          </button>
        </div>
      </header>

      <form className="preview-url-row" onSubmit={submitUrl}>
        <label className="sr-only" htmlFor="preview-url-input">
          Preview URL
        </label>
        <input
          id="preview-url-input"
          className="preview-url-input"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="http://localhost:5173"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <button
          type="submit"
          className="secondary-button compact-button"
          disabled={!input.trim()}
        >
          Go
        </button>
      </form>

      {notice ? (
        <p className="preview-notice" role="status">
          {notice}
        </p>
      ) : null}

      {phase === "blocked" && frameUrl === null && parsePreviewUrl(input).ok ? (
        <div className="preview-blocked" role="status">
          <p>
            That address is not a local or private address, so it cannot be
            embedded here. Open it in the browser instead.
          </p>
          <button type="button" className="text-button" onClick={openExternal}>
            Open in browser
          </button>
        </div>
      ) : null}

      {frameVisible ? (
        <div className="preview-frame-wrap">
          <iframe
            key={frameKey}
            className="preview-frame"
            src={frameUrl}
            title={`Preview of ${frameUrl}`}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            referrerPolicy="no-referrer"
            onLoad={handleFrameLoad}
          />
          {phase === "loading" ? (
            <div className="preview-frame-overlay" role="status">
              <span className="typing-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span>Loading preview…</span>
            </div>
          ) : null}
          {phase === "timeout" ? (
            <div className="preview-frame-overlay preview-timeout" role="alert">
              <span>The preview did not respond.</span>
              <div className="preview-timeout-actions">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => frameUrl && load(frameUrl)}
                >
                  Retry
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={openExternal}
                >
                  Open in browser
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {phase === "idle" && !notice ? (
        <div className="preview-empty">
          <p>
            Enter a local address above to load a live preview of a running
            app, for example a dev server started in the terminal.
          </p>
        </div>
      ) : null}

      <form className="preview-command-row" onSubmit={submitCommand}>
        <span className="panel-kicker">RUN IN TERMINAL</span>
        <div className="preview-command-fields">
          <label className="sr-only" htmlFor="preview-command-input">
            Command to run in the terminal
          </label>
          <input
            id="preview-command-input"
            className="preview-url-input"
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="npm run dev"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
          />
          <button
            type="submit"
            className="secondary-button compact-button"
            disabled={!connected || !command.trim()}
            title={
              connected
                ? "Send this command to the project terminal"
                : "Connect to OpenCode before running commands"
            }
          >
            Run
          </button>
        </div>
        <small className="preview-command-note">
          Sends this command to the project terminal and runs it there so the
          preview server starts.
        </small>
      </form>
    </section>
  );
}
