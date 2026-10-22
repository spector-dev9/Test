import { useMemo, useState } from "react";
import { CopyButton } from "./CopyButton";
import {
  toolHasDetails,
  toolPreview,
  toolStateClass,
  toolStatusLabel,
} from "../lib/tools.js";

export function ToolCard({ tool }) {
  const [open, setOpen] = useState(false);
  const state = toolStateClass(tool.status);
  const summary = tool.summary || tool.detail || tool.title || "";
  const hasDetails = toolHasDetails(tool);

  const preview = useMemo(
    () => toolPreview(tool.output),
    [tool.output],
  );

  return (
    <div className={`tool-card tool-${state}${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="tool-card-head"
        onClick={() => hasDetails && setOpen((value) => !value)}
        aria-expanded={hasDetails ? open : undefined}
        disabled={!hasDetails}
        title={hasDetails ? "Show tool details" : undefined}
      >
        <span className="tool-card-chevron" aria-hidden="true">
          {hasDetails ? (open ? "▾" : "▸") : "·"}
        </span>
        <span className="tool-card-name">{tool.name}</span>
        {summary ? (
          <span className="tool-card-summary" title={summary}>
            {summary}
          </span>
        ) : null}
        {tool.status === "running" ? (
          <span className="tool-card-spinner" aria-hidden="true" />
        ) : null}
        <span className={`tool-card-status tool-card-status-${state}`}>
          {toolStatusLabel(tool.status)}
        </span>
      </button>

      {open ? (
        <div className="tool-card-body">
          {tool.title ? (
            <p className="tool-card-title">{tool.title}</p>
          ) : null}

          {tool.input ? (
            <div className="tool-card-block">
              <div className="tool-card-block-head">
                <span>Input</span>
                <CopyButton
                  text={tool.inputFull || tool.input}
                  title="Copy full tool input"
                  className="code-copy"
                />
              </div>
              <pre className="tool-card-code">{tool.input}</pre>
            </div>
          ) : null}

          {tool.output ? (
            <div className="tool-card-block">
              <div className="tool-card-block-head">
                <span>Output</span>
                <CopyButton
                  text={tool.outputFull || tool.output}
                  title="Copy full tool output"
                  className="code-copy"
                />
              </div>
              <pre className="tool-card-code tool-card-output">
                {tool.output}
              </pre>
            </div>
          ) : null}

          {tool.error ? (
            <div className="tool-card-block">
              <div className="tool-card-block-head">
                <span>Error</span>
                <CopyButton
                  text={tool.errorFull || tool.error}
                  title="Copy full tool error"
                  className="code-copy"
                />
              </div>
              <pre className="tool-card-code tool-card-error">{tool.error}</pre>
            </div>
          ) : null}
        </div>
      ) : preview ? (
        <p className="tool-card-preview">{preview}</p>
      ) : null}
    </div>
  );
}
