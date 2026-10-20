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
          </div>

          {message.text ? (
            <div className="message-text">{message.text}</div>
          ) : null}

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
