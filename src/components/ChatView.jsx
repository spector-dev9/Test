import { useEffect, useMemo, useRef } from "react";
import { MAX_COMPOSER_CHARS } from "../lib/opencode";
import {
  filterCommands,
  formatSessionTime,
  normalizeConversation,
  offlineHelp,
  offlineTitle,
  parseComposerSubmission,
} from "../lib/workspace";
import { ConnectionBanner } from "./ConnectionBanner";
import { MessageList } from "./MessageList";

const SUGGESTIONS = [
  "Explain this project and its main entry points.",
  "Find one likely bug and explain how to fix it.",
  "Suggest a small feature that would improve this app.",
];

export function ChatView({
  health,
  connected,
  connection,
  canRefresh,
  onRefresh,
  session,
  messages,
  phase,
  actionError,
  lastSubmission,
  onSend,
  onRetrySend,
  onStop,
  onRefreshMessages,
  onNewSession,
  creatingSession,
  commands,
  effectiveModel,
  modelLabel,
  onOpenModels,
  draft,
  onDraftChange,
}) {
  const textareaRef = useRef(null);
  const scrollRef = useRef(null);
  const bottomRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const submittingRef = useRef(false);
  const previousSessionRef = useRef(session?.id ?? null);

  const rows = useMemo(
    () => normalizeConversation(messages.data),
    [messages.data],
  );
  const commandMatches = useMemo(
    () => filterCommands(commands.data, draft),
    [commands.data, draft],
  );
  const showCommands =
    Boolean(session) &&
    connected &&
    draft.startsWith("/") &&
    commandMatches.length > 0;
  const busy =
    phase === "sending" ||
    phase === "working" ||
    phase === "stopping";
  const canSubmit =
    connected &&
    Boolean(session) &&
    phase === "idle" &&
    draft.trim().length > 0;
  const showEmptyConversation =
    messages.status === "ready" &&
    rows.length === 0 &&
    !busy;

  useEffect(() => {
    const previous = previousSessionRef.current;
    if (previous !== (session?.id ?? null)) {
      onDraftChange("");
    }
    previousSessionRef.current = session?.id ?? null;
    stickToBottomRef.current = true;
  }, [onDraftChange, session?.id]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [draft]);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [rows, phase, actionError]);

  async function submitDraft(event) {
    event?.preventDefault();
    if (!canSubmit || submittingRef.current) return;

    const request = parseComposerSubmission(draft, commands.data);
    if (!request) return;

    submittingRef.current = true;
    try {
      const payload =
        request.kind === "command"
          ? { ...request, model: effectiveModel }
          : {
              ...request,
              model: effectiveModel,
              agent: session?.agent || undefined,
            };
      const accepted = await onSend(payload);
      if (accepted) onDraftChange("");
    } finally {
      submittingRef.current = false;
    }
  }

  function handleKeyDown(event) {
    if (
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey) &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      submitDraft();
    }
  }

  function chooseCommand(command) {
    onDraftChange(`/${command.name} `);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function handleScroll() {
    const element = scrollRef.current;
    if (!element) return;
    const distance =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    stickToBottomRef.current = distance < 80;
  }

  const heading = session
    ? session.title || "Untitled session"
    : connected
      ? "What are we building?"
      : connection.tone === "offline"
        ? offlineTitle(health.errorKind)
        : "Looking for your workspace…";

  return (
    <div className="chat">
      <div
        className="chat-scroll"
        ref={scrollRef}
        onScroll={handleScroll}
      >
        <div className="chat-heading">
          <div className="chat-heading-copy">
            <p className="eyebrow">
              {session
                ? `SESSION · ${formatSessionTime(session.time?.updated)}`
                : "YOUR WORKSPACE"}
            </p>
            <h1 className={session ? "chat-session-title" : undefined}>
              {heading}
            </h1>
            <p className="subtitle">
              {session
                ? `${session.agent || "agent"} · messages stay on your local server`
                : "Your coding agent, in a workspace of your own."}
            </p>
          </div>
          <button
            type="button"
            className="model-pill model-button"
            onClick={onOpenModels}
            title="Choose a model for new messages"
          >
            ◈ {modelLabel}
          </button>
        </div>

        <ConnectionBanner
          health={health}
          show={connection.tone === "offline"}
          canRetry={canRefresh}
          onRetry={onRefresh}
        />

        {!session ? (
          <section className="welcome" aria-live="polite">
            <div className={`welcome-icon ${connection.tone}`}>✳</div>

            {connected ? (
              <>
                <h2>Start a conversation.</h2>
                <p>
                  Create a session for this project. You can choose a model,
                  send prompts, use slash commands, and stop a running agent.
                </p>
                <div className="welcome-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={onNewSession}
                    disabled={creatingSession}
                  >
                    ＋ {creatingSession ? "Creating…" : "New session"}
                  </button>
                </div>
              </>
            ) : connection.tone === "offline" ? (
              <>
                <h2>{offlineTitle(health.errorKind)}.</h2>
                <p>{offlineHelp(health.errorKind)}</p>
              </>
            ) : (
              <>
                <h2>Looking for your workspace…</h2>
                <p>
                  Checking the local OpenCode server and reading this project's
                  sessions.
                </p>
              </>
            )}

            <div className="workspace-facts">
              <span className="fact">
                ◈{" "}
                {connected
                  ? `Server v${health.data.version}`
                  : connection.tone === "offline"
                    ? "Server offline"
                    : "Checking server"}
              </span>
              <span className="fact">⌁ {modelLabel}</span>
              <span className="fact">This project only</span>
            </div>
          </section>
        ) : (
          <section className="conversation" aria-label="Conversation">
            {messages.status === "loading" ? (
              <div className="message-skeletons" aria-hidden="true">
                <span className="message-skeleton" />
                <span className="message-skeleton short" />
                <span className="message-skeleton" />
              </div>
            ) : null}

            {messages.status === "error" ? (
              <div className="inline-error conversation-error" role="alert">
                <span>{messages.error || "Messages could not be loaded."}</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={onRefreshMessages}
                  disabled={!connected}
                >
                  Retry
                </button>
              </div>
            ) : null}

            {showEmptyConversation ? (
              <div className="empty-conversation">
                <div className="welcome-icon online">✳</div>
                <h2>No messages yet.</h2>
                <p>Send the first prompt to start this session.</p>
                <div className="suggestions">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      type="button"
                      key={suggestion}
                      onClick={() => {
                        onDraftChange(suggestion);
                        textareaRef.current?.focus();
                      }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {rows.length > 0 ? (
              <MessageList messages={rows} phase={phase} />
            ) : null}

            <div ref={bottomRef} />
          </section>
        )}
      </div>

      <div className="composer-shell">
        {actionError ? (
          <div className="action-error" role="alert">
            <span>{actionError.message}</span>
            <div className="action-error-buttons">
              {actionError.retryable && lastSubmission ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={onRetrySend}
                  disabled={!connected || phase !== "idle"}
                >
                  Retry send
                </button>
              ) : null}
              {phase === "working" ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={onStop}
                >
                  Try stop again
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {showCommands ? (
          <div className="command-palette" role="listbox" aria-label="Commands">
            <p className="command-label">COMMANDS</p>
            {commandMatches.map((command) => (
              <button
                type="button"
                role="option"
                aria-selected="false"
                key={command.name}
                className="command-option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseCommand(command)}
              >
                <span className="command-name">/{command.name}</span>
                <span className="command-description">
                  {command.description || "Run this command"}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <form className="composer" onSubmit={submitDraft}>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            maxLength={MAX_COMPOSER_CHARS}
            disabled={!connected || !session}
            placeholder={
              connected
                ? session
                  ? "Ask OpenCode to inspect, explain, or change this project…"
                  : "Create a session to start"
                : "Reconnect to the local OpenCode server"
            }
            aria-label="Prompt"
            aria-describedby="composer-status"
          />
          <div className="composer-footer">
            <span id="composer-status">
              {!connected
                ? "Server offline · reconnect to send"
                : !session
                  ? "Create a session to start"
                  : phase === "sending"
                    ? "Sending prompt…"
                    : phase === "working"
                      ? "Agent working · you can stop it"
                      : phase === "stopping"
                        ? "Stopping the agent…"
                        : draft.length > MAX_COMPOSER_CHARS - 2000
                          ? `${draft.length.toLocaleString()} / ${MAX_COMPOSER_CHARS.toLocaleString()}`
                          : "Ctrl/⌘ + Enter to send · type / for commands"}
            </span>
            <div className="composer-actions">
              {phase === "working" ? (
                <button
                  type="button"
                  className="send stop"
                  onClick={onStop}
                  aria-label="Stop the running agent"
                  title="Stop the running agent"
                >
                  ■
                </button>
              ) : (
                <button
                  className="send"
                  type="submit"
                  disabled={!canSubmit}
                  aria-label="Send prompt"
                  title="Send prompt"
                >
                  {phase === "sending" ? "…" : "↑"}
                </button>
              )}
            </div>
          </div>
        </form>
        <p className="disclaimer">
          Review agent actions before allowing changes to your files.
        </p>
      </div>
    </div>
  );
}
