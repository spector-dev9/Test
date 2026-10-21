import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MAX_COMPOSER_CHARS } from "../lib/opencode";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_PROMPT_ATTACHMENTS,
  formatAttachmentSize,
  imageDataUrlBytes,
} from "../lib/attachments";
import { projectLabel } from "../lib/project";
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
import { PermissionPrompts } from "./PermissionPrompts";
import { QuestionPrompts } from "./QuestionPrompts";
import { TodoDialog } from "./TodoDialog";

const SUGGESTIONS = [
  "Explain this project and its main entry points.",
  "Find one likely bug and explain how to fix it.",
  "Suggest a small feature that would improve this app.",
];

const IMAGE_ATTEMPTS = [
  [1800, 0.85],
  [1600, 0.75],
  [1400, 0.7],
  [1200, 0.62],
  [1000, 0.55],
];
const MAX_SOURCE_IMAGE_BYTES = 15 * 1024 * 1024;
const IMAGE_FILE_PATTERN = /^image\/(png|jpeg|webp|gif)$/;

function attachmentId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `image-${Date.now()}-${Math.random()}`
  );
}

async function prepareImageAttachment(file) {
  if (!IMAGE_FILE_PATTERN.test(file.type)) {
    throw new Error("Only PNG, JPEG, WebP, and GIF images are supported.");
  }

  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error("That image is too large to process on this device.");
  }

  const bitmap = await createImageBitmap(file);

  try {
    for (const [maxDimension, quality] of IMAGE_ATTEMPTS) {
      const scale = Math.min(
        1,
        maxDimension / Math.max(bitmap.width, bitmap.height),
      );
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("This device could not process that image.");
      }

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);

      const url = canvas.toDataURL("image/jpeg", quality);
      const size = imageDataUrlBytes(url);

      if (size > 0 && size <= MAX_ATTACHMENT_BYTES) {
        const base = file.name.replace(/\.[^.]+$/, "") || "image";
        return {
          id: attachmentId(),
          mime: "image/jpeg",
          filename: `${base.slice(0, 110)}.jpg`,
          url,
          size,
        };
      }
    }
  } finally {
    bitmap.close?.();
  }

  throw new Error(
    `That image is still larger than ${formatAttachmentSize(MAX_ATTACHMENT_BYTES)} after compression.`,
  );
}

export function ChatView({
  health,
  connected,
  connection,
  canRefresh,
  onRefresh,
  session,
  project,
  messages,
  phase,
  actionError,
  onClearActionError,
  lastSubmission,
  permissions,
  permissionError,
  replyingPermissionId,
  onPermissionReply,
  questions,
  questionError,
  answeringQuestionId,
  onQuestionReply,
  onQuestionReject,
  todos,
  todoError,
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
  const stickToBottomRef = useRef(true);
  const submittingRef = useRef(false);
  const fileInputRef = useRef(null);
  const previousSessionRef = useRef(session?.id ?? null);
  const [showLatest, setShowLatest] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [todosOpen, setTodosOpen] = useState(false);

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
    attachments.length === 0 &&
    draft.startsWith("/") &&
    commandMatches.length > 0;
  const busy =
    phase === "sending" ||
    phase === "working" ||
    phase === "stopping";
  const permissionPending = permissions.length > 0;
  const questionPending = questions.length > 0;
  const canSubmit =
    connected &&
    Boolean(session) &&
    phase === "idle" &&
    !permissionPending &&
    !questionPending &&
    (draft.trim().length > 0 || attachments.length > 0);
  const showEmptyConversation =
    messages.status === "ready" &&
    rows.length === 0 &&
    !busy;

  const scrollToLatest = useCallback((behavior = "auto") => {
    const element = scrollRef.current;
    if (!element) return;

    stickToBottomRef.current = true;
    setShowLatest(false);
    element.scrollTo({
      top: element.scrollHeight,
      behavior,
    });
  }, []);

  useEffect(() => {
    const previous = previousSessionRef.current;
    if (previous !== (session?.id ?? null)) {
      onDraftChange("");
      setAttachments([]);
      setAttachmentError("");
      setTodosOpen(false);
    }
    previousSessionRef.current = session?.id ?? null;
    stickToBottomRef.current = true;
    requestAnimationFrame(() => scrollToLatest("auto"));
  }, [onDraftChange, scrollToLatest, session?.id]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [draft]);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    scrollToLatest("auto");
  }, [
    rows,
    phase,
    actionError,
    permissionPending,
    questionPending,
    scrollToLatest,
  ]);

  useEffect(() => {
    function handleViewportChange() {
      if (!stickToBottomRef.current) return;
      requestAnimationFrame(() => scrollToLatest("auto"));
    }

    window.visualViewport?.addEventListener("resize", handleViewportChange);
    window.addEventListener("resize", handleViewportChange);

    return () => {
      window.visualViewport?.removeEventListener(
        "resize",
        handleViewportChange,
      );
      window.removeEventListener("resize", handleViewportChange);
    };
  }, [scrollToLatest]);

  async function submitDraft(event) {
    event?.preventDefault();
    if (!canSubmit || submittingRef.current) return;

    let request = parseComposerSubmission(draft, commands.data);

    if (!request && attachments.length > 0) {
      request = { kind: "prompt", text: "" };
    }

    if (!request) return;

    if (request.kind === "command" && attachments.length > 0) {
      setAttachmentError("Slash commands cannot include image attachments.");
      return;
    }

    submittingRef.current = true;
    try {
      const payload =
        request.kind === "command"
          ? { ...request, model: effectiveModel }
          : {
              ...request,
              text: request.text || "Please review the attached image.",
              model: effectiveModel,
              agent: session?.agent || undefined,
              attachments: attachments.map(({ mime, filename, url }) => ({
                mime,
                filename,
                url,
              })),
            };
      const accepted = await onSend(payload);
      if (accepted) {
        onDraftChange("");
        setAttachments([]);
        setAttachmentError("");
        scrollToLatest("smooth");
      }
    } finally {
      submittingRef.current = false;
    }
  }

  function removeAttachment(id) {
    setAttachments((previous) =>
      previous.filter((attachment) => attachment.id !== id),
    );
    setAttachmentError("");
  }

  async function handleFilesChange(event) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;

    if (draft.trim().startsWith("/")) {
      setAttachmentError("Slash commands cannot include image attachments.");
      return;
    }

    const room = MAX_PROMPT_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      setAttachmentError(
        `You can attach up to ${MAX_PROMPT_ATTACHMENTS} images per prompt.`,
      );
      return;
    }

    const next = [];
    let error = "";

    for (const file of files.slice(0, room)) {
      try {
        next.push(await prepareImageAttachment(file));
      } catch (caught) {
        error =
          caught instanceof Error
            ? caught.message
            : "That image could not be attached.";
      }
    }

    if (files.length > room) {
      error = `You can attach up to ${MAX_PROMPT_ATTACHMENTS} images per prompt.`;
    }

    if (next.length > 0) {
      setAttachments((previous) =>
        [...previous, ...next].slice(0, MAX_PROMPT_ATTACHMENTS),
      );
      requestAnimationFrame(() => textareaRef.current?.focus());
    }

    setAttachmentError(error);
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
    const nearBottom = distance < 80;
    stickToBottomRef.current = nearBottom;
    setShowLatest(!nearBottom && rows.length > 0);
  }

  function handleComposerFocus() {
    if (!stickToBottomRef.current) return;
    requestAnimationFrame(() => scrollToLatest("smooth"));
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
          <div className="chat-heading-actions">
            {session && todos.length > 0 ? (
              <button
                type="button"
                className="model-pill todo-trigger"
                onClick={() => setTodosOpen(true)}
                title="Open the session todo list"
              >
                ☑ {todos.filter((todo) => todo.status === "completed").length}/
                {todos.length}
              </button>
            ) : null}
            <button
              type="button"
              className="model-pill model-button"
              onClick={onOpenModels}
              title="Choose a model for new messages"
            >
              ◈ {modelLabel}
            </button>
          </div>
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
              <span className="fact">
                ◫ {project ? projectLabel(project) : "This project"}
              </span>
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
              <MessageList
                messages={rows}
                phase={phase}
                resetKey={session?.id}
              />
            ) : null}
          </section>
        )}
      </div>

      <div className="composer-shell">
        {showLatest ? (
          <button
            type="button"
            className="jump-latest"
            onClick={() => scrollToLatest("smooth")}
          >
            ↓ Latest
          </button>
        ) : null}

        <PermissionPrompts
          permissions={permissions}
          onReply={onPermissionReply}
          busyId={replyingPermissionId}
          error={permissionError}
        />

        <QuestionPrompts
          key={questions[0]?.id ?? "no-question"}
          questions={questions}
          onReply={onQuestionReply}
          onReject={onQuestionReject}
          busyId={answeringQuestionId}
          error={questionError}
        />

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
              <button
                type="button"
                className="text-button"
                onClick={onClearActionError}
              >
                Dismiss
              </button>
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
          {attachments.length > 0 ? (
            <div className="composer-attachments">
              {attachments.map((attachment) => (
                <div className="composer-attachment" key={attachment.id}>
                  <img src={attachment.url} alt="" />
                  <span>
                    <strong>{attachment.filename}</strong>
                    <small>{formatAttachmentSize(attachment.size)}</small>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(attachment.id)}
                    aria-label={`Remove ${attachment.filename}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {attachmentError ? (
            <p className="composer-attachment-error" role="alert">
              {attachmentError}
            </p>
          ) : null}

          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={handleComposerFocus}
            rows={1}
            maxLength={MAX_COMPOSER_CHARS}
            disabled={
              !connected || !session || permissionPending || questionPending
            }
            placeholder={
              connected
                ? session
                  ? permissionPending
                    ? "Respond to the permission request above"
                    : questionPending
                      ? "Answer the question to continue"
                      : "Ask OpenCode to inspect, explain, or change this project…"
                  : "Create a session to start"
                : "Reconnect to the local OpenCode server"
            }
            aria-label="Prompt"
            aria-describedby="composer-status"
          />
          <div className="composer-footer">
            <div className="composer-meta">
              <button
                type="button"
                className="composer-attach"
                onClick={() => fileInputRef.current?.click()}
                disabled={
                  !connected ||
                  creatingSession ||
                  permissionPending ||
                  questionPending ||
                  phase !== "idle" ||
                  attachments.length >= MAX_PROMPT_ATTACHMENTS
                }
                title={
                  attachments.length >= MAX_PROMPT_ATTACHMENTS
                    ? `Maximum ${MAX_PROMPT_ATTACHMENTS} images`
                    : "Attach images"
                }
              >
                Attach
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                hidden
                onChange={handleFilesChange}
              />
              <span id="composer-status">
                {!connected
                  ? "Server offline · reconnect to send"
                  : !session
                    ? "Create a session to start"
                    : permissionPending
                      ? "Permission required · review the prompt above"
                      : questionPending
                        ? "Question pending · answer above to continue"
                        : phase === "sending"
                        ? "Sending prompt…"
                        : phase === "working"
                          ? "Agent working · you can stop it"
                          : phase === "stopping"
                            ? "Stopping the agent…"
                            : attachments.length > 0
                              ? `${attachments.length} image${attachments.length === 1 ? "" : "s"} attached · Ctrl/⌘ + Enter to send`
                              : draft.length > MAX_COMPOSER_CHARS - 2000
                                ? `${draft.length.toLocaleString()} / ${MAX_COMPOSER_CHARS.toLocaleString()}`
                                : "Ctrl/⌘ + Enter to send · type / for commands"}
              </span>
            </div>
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

      <TodoDialog
        open={todosOpen}
        todos={todos}
        error={todoError}
        onClose={() => setTodosOpen(false)}
      />
    </div>
  );
}
