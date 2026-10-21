import { CopyButton } from "./CopyButton";
import { formatSessionTime } from "../lib/workspace";

function ToolLine({ tool }) {
  return (
    <div className="message-tool">
      <span aria-hidden="true">⚙</span>
      <span>{tool.name}</span>
      <span className="tool-status">{tool.status}</span>
    </div>
  );
}

function textSegments(text) {
  const pattern = /```([^\n`]*)\n?([\s\S]*?)```/g;
  const segments = [];
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: "text",
        value: text.slice(lastIndex, match.index),
      });
    }

    segments.push({
      type: "code",
      language:
        match[1].trim().split(/\s+/)[0]?.slice(0, 24) || "code",
      value: match[2].replace(/\n$/, ""),
    });
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }

  return segments;
}

function MessageText({ text }) {
  return (
    <div className="message-text">
      {textSegments(text).map((segment, index) =>
        segment.type === "code" ? (
          <div className="message-code" key={`code-${index}`}>
          <div className="message-code-head">
            <span>{segment.language}</span>
            <CopyButton
              text={segment.value}
              title="Copy code"
              className="code-copy"
            />
          </div>
            <pre><code>{segment.value}</code></pre>
          </div>
        ) : (
          <span key={`text-${index}`}>{segment.value}</span>
        ),
      )}
    </div>
  );
}

export function MessageList({ messages, phase }) {
  return (
    <div className="message-list">
      {messages.map((message) => (
        <article
          className={`message message-${message.role}`}
          key={message.id}
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
            {message.role === "assistant" && message.text ? (
              <CopyButton
                text={message.text}
                title={message.completed ? "Copy message" : "Copy current message text"}
                className="message-copy"
              />
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
                <ToolLine
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
