import { Fragment, memo, useMemo } from "react";
import { parseMarkdown } from "../lib/markdown";

function renderInlineNodes(nodes, onOpenLink, keyPrefix) {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;

    switch (node.type) {
      case "text": {
        const parts = node.value.split("\n");
        if (parts.length === 1) return node.value;
        return (
          <Fragment key={key}>
            {parts.map((part, partIndex) => (
              <Fragment key={`${key}-${partIndex}`}>
                {partIndex > 0 ? <br /> : null}
                {part}
              </Fragment>
            ))}
          </Fragment>
        );
      }
      case "code":
        return (
          <code className="md-inline-code" key={key}>
            {node.value}
          </code>
        );
      case "strong":
        return (
          <strong key={key}>
            {renderInlineNodes(node.children, onOpenLink, key)}
          </strong>
        );
      case "emphasis":
        return (
          <em key={key}>
            {renderInlineNodes(node.children, onOpenLink, key)}
          </em>
        );
      case "strike":
        return (
          <del key={key}>
            {renderInlineNodes(node.children, onOpenLink, key)}
          </del>
        );
      case "link": {
        const href = node.href;
        const safe =
          typeof href === "string" && /^(https?:|mailto:)/i.test(href);

        if (!safe) {
          return (
            <span key={key}>
              {renderInlineNodes(node.children, onOpenLink, key)}
            </span>
          );
        }

        return (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(event) => {
              if (!onOpenLink) return;
              event.preventDefault();
              onOpenLink(href);
            }}
          >
            {renderInlineNodes(node.children, onOpenLink, key)}
          </a>
        );
      }
      default:
        return null;
    }
  });
}

function renderBlocks(blocks, options, keyPrefix) {
  const { onOpenLink, renderCodeBlock } = options;

  return blocks.map((block, index) => {
    const key = `${keyPrefix}-${index}`;

    switch (block.type) {
      case "paragraph":
        return (
          <p key={key}>
            {renderInlineNodes(block.children, onOpenLink, key)}
          </p>
        );
      case "heading": {
        const Tag = `h${Math.min(6, Math.max(1, block.level + 1))}`;
        return (
          <Tag key={key}>
            {renderInlineNodes(block.children, onOpenLink, key)}
          </Tag>
        );
      }
      case "code": {
        if (renderCodeBlock) {
          return renderCodeBlock({
            language: block.language,
            value: block.value,
            key,
          });
        }
        return (
          <div className="message-code" key={key}>
            <pre>
              <code>{block.value}</code>
            </pre>
          </div>
        );
      }
      case "list":
        return block.ordered ? (
          <ol key={key}>
            {block.items.map((item, itemIndex) => (
              <li key={`${key}-${itemIndex}`}>
                {renderBlocks(item.children, options, `${key}-${itemIndex}`)}
              </li>
            ))}
          </ol>
        ) : (
          <ul key={key}>
            {block.items.map((item, itemIndex) => (
              <li key={`${key}-${itemIndex}`}>
                {renderBlocks(item.children, options, `${key}-${itemIndex}`)}
              </li>
            ))}
          </ul>
        );
      case "quote":
        return (
          <blockquote key={key}>
            {renderBlocks(block.children, options, key)}
          </blockquote>
        );
      case "rule":
        return <hr key={key} />;
      case "table":
        return (
          <div className="md-table-wrap" key={key}>
            <table className="md-table">
              <thead>
                <tr>
                  {block.header.map((cell, cellIndex) => (
                    <th
                      key={`${key}-h-${cellIndex}`}
                      style={{
                        textAlign: block.align[cellIndex] ?? "left",
                      }}
                    >
                      {renderInlineNodes(cell, onOpenLink, `${key}-h-${cellIndex}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={`${key}-r-${rowIndex}`}>
                    {row.map((cell, cellIndex) => (
                      <td
                        key={`${key}-r-${rowIndex}-c-${cellIndex}`}
                        style={{
                          textAlign: block.align[cellIndex] ?? "left",
                        }}
                      >
                        {renderInlineNodes(
                          cell,
                          onOpenLink,
                          `${key}-r-${rowIndex}-c-${cellIndex}`,
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      default:
        return null;
    }
  });
}

export const MarkdownText = memo(function MarkdownText({
  text,
  className,
  onOpenLink,
  renderCodeBlock,
}) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const options = useMemo(
    () => ({ onOpenLink, renderCodeBlock }),
    [onOpenLink, renderCodeBlock],
  );

  return (
    <div className={className ? `markdown ${className}` : "markdown"}>
      {renderBlocks(blocks, options, "md")}
    </div>
  );
});
