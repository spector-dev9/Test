import { useState } from "react";
import { Browser } from "@capacitor/browser";
import { CopyButton } from "./CopyButton";
import { ErrorBoundary } from "./ErrorBoundary";
import { MarkdownText } from "./Markdown";
import { ToolCard } from "./ToolCard";
import { highlightCode } from "../lib/highlight";
import {
  formatSessionTime,
  isMessageIdentifier,
} from "../lib/workspace";

function openLink(url) {
  Browser.open({ url }).catch(() => {});
}

function renderCodeBlock({ language, value, key }) {
  const tokens = highlightCode(value, language);

  return (
    <div className="message-code" key={key}>
      <div className="message-code-head">
        <span>{language || "code"}</span>
        <CopyButton
          text={value}
          title="Copy code"
          className="code-copy"
        />
      </div>
      <pre>
        <code>
          {tokens.map((token, index) =>
            token.type === "plain" ? (
              token.text
            ) : (
              <span className={`tok tok-${token.type}`} key={`t-${index}`}>
                {token.text}
              </span>
            ),
          )}
        </code>
      </pre>
    </div>
  );
}

function MessageText({ text }) {
  return (
    <MarkdownText
      text={text}
      className="message-text"
      onOpenLink={openLink}
      renderCodeBlock={renderCodeBlock}
    />
  );
}

const INITIAL_MESSAGE_WINDOW = 30;
const MESSAGE_WINDOW_PAGE = 30;

export function MessageList({
  messages,
  phase,
  resetKey,
  onEdit,
  onRevert,
  actionsDisabled = false,
  reverting = false,
}) {
  const [windowState, setWindowState] = useState({
    key: resetKey,
    count: INITIAL_MESSAGE_WINDOW,
  });
  const visibleCount =
    windowState.key === resetKey
      ? windowState.count
      : INITIAL_MESSAGE_WINDOW;
  const hiddenCount = Math.max(0, messages.length - visibleCount);
  const visibleMessages =
    hiddenCount > 0 ? messages.slice(hiddenCount) : messages;

  return (
    <div className="message-list">
      {hiddenCount > 0 ? (
        <div className="message-window-controls">
          <button
            type="button"
            className="secondary-button compact-button"
            onClick={() =>
              setWindowState({
                key: resetKey,
                count: visibleCount + MESSAGE_WINDOW_PAGE,
              })
            }
          >
            Show {Math.min(hiddenCount, MESSAGE_WINDOW_PAGE)} earlier messages
            {hiddenCount > MESSAGE_WINDOW_PAGE
              ? ` (${hiddenCount} hidden)`
              : ""}
          </button>
        </div>
      ) : null}

      {visibleMessages.map((message) => (
        <ErrorBoundary
          key={message.id}
          label="This message"
          variant="inline"
        >
          <article
            className={`message message-${message.role}`}
          >
          <div className="message-meta">
            <span className="message-role">
              {message.role === "user" ? "You" : "OpenCode"}
            </span>
            {message.created ? (
              <time dateTime={new Date(message.created).toISOString()}>
                {formatSessionTime(message.created)}
              </time>
            ) : null}
            {message.model ? <span>{message.model}</span> : null}
            {message.role === "assistant" && !message.completed ? (
              <span className="message-live">working</span>
            ) : null}
            {message.text ||
            message.tools.length > 0 ||
            isMessageIdentifier(message.id) ? (
              <div className="message-actions">
                {message.text ? (
                  <CopyButton
                    text={message.text}
                    title={
                      message.completed
                        ? "Copy message text"
                        : "Copy current message text"
                    }
                    className="message-copy"
                  />
                ) : null}
                {message.role === "user" &&
                message.text &&
                isMessageIdentifier(message.id) ? (
                  <button
                    type="button"
                    className="message-action"
                    onClick={() => onEdit?.(message)}
                    disabled={actionsDisabled || reverting}
                    title="Edit this message"
                  >
                    Edit
                  </button>
                ) : null}
                {isMessageIdentifier(message.id) ? (
                  <button
                    type="button"
                    className="message-action danger-text"
                    onClick={() => onRevert?.(message)}
                    disabled={actionsDisabled || reverting}
                    title={
                      message.role === "assistant"
                        ? "Revert this response and undo its file changes"
                        : "Revert this message and everything after it"
                    }
                  >
                    {reverting ? "Reverting…" : "Revert"}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          {message.text ? <MessageText text={message.text} /> : null}

          {message.attachments?.length > 0 ? (
            <div className="message-attachments">
              {message.attachments.map((attachment, index) => (
                <figure
                  className="message-attachment"
                  key={`${attachment.filename}-${index}`}
                >
                  <img src={attachment.url} alt={attachment.filename} />
                  <figcaption>{attachment.filename}</figcaption>
                </figure>
              ))}
            </div>
          ) : null}

          {message.tools.length > 0 ? (
            <div className="message-tools">
              {message.tools.map((tool, index) => (
                <ToolCard
                  key={tool.id ?? `${tool.name}-${tool.status}-${index}`}
                  tool={tool}
                />
              ))}
            </div>
          ) : null}

            {message.error ? (
              <div className="message-error">{message.error}</div>
            ) : null}
          </article>
        </ErrorBoundary>
      ))}

      {phase === "sending" ? (
        <div className="working-line" role="status">
          <span className="typing-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>Sending prompt…</span>
        </div>
      ) : null}

      {phase === "working" || phase === "stopping" ? (
        <div className="working-line" role="status">
          <span className="typing-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>
            {phase === "stopping"
              ? "Stopping the agent…"
              : "The agent is working…"}
          </span>
        </div>
      ) : null}
    </div>
  );
}
