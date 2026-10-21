const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;

const ESCAPABLE = "\\`*_{}[]()#+-.!|~>";

function findSingleCloser(text, start, marker) {
  let i = start;

  while (i < text.length) {
    const index = text.indexOf(marker, i);
    if (index === -1) return -1;

    const prev = text[index - 1] ?? "";
    const next = text[index + 1] ?? "";

    if (prev === "\\" ) {
      i = index + 1;
      continue;
    }

    if (prev === marker || next === marker) {
      i = index + 1;
      continue;
    }

    if (!prev || /\s/.test(prev) || /[\w.,;:!?)\]]/.test(next)) {
      i = index + 1;
      continue;
    }

    return index;
  }

  return -1;
}

export function parseInline(text, depth = 0) {
  const nodes = [];
  let plain = "";

  const flush = () => {
    if (plain) {
      nodes.push({ type: "text", value: plain });
      plain = "";
    }
  };

  if (typeof text !== "string" || !text) return nodes;

  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (char === "\\" && i + 1 < text.length && ESCAPABLE.includes(text[i + 1])) {
      plain += text[i + 1];
      i += 2;
      continue;
    }

    if (char === "`") {
      let run = 1;
      while (text[i + run] === "`") run += 1;

      const closer = text.indexOf("`".repeat(run), i + run);

      if (closer !== -1) {
        flush();
        let value = text.slice(i + run, closer);
        if (value.length > 1 && value.startsWith(" ") && value.endsWith(" ") && value.trim()) {
          value = value.slice(1, -1);
        }
        nodes.push({ type: "code", value });
        i = closer + run;
        continue;
      }
    }

    if ((char === "*" || char === "_") && depth < 5) {
      const marker = char;
      const double = text[i + 1] === marker;

      if (double) {
        const end = text.indexOf(marker + marker, i + 2);
        const inner = end === -1 ? "" : text.slice(i + 2, end);

        if (end !== -1 && end > i + 2 && inner.trim()) {
          flush();
          nodes.push({
            type: "strong",
            children: parseInline(inner, depth + 1),
          });
          i = end + 2;
          continue;
        }
      } else {
        const prev = text[i - 1] ?? "";
        const nextAfter = text[i + 1] ?? "";

        const canOpen =
          !/[\w]/.test(prev) &&
          nextAfter &&
          !/\s/.test(nextAfter) &&
          nextAfter !== marker;

        if (canOpen) {
          const end = findSingleCloser(text, i + 1, marker);

          if (end !== -1 && end > i + 1) {
            const inner = text.slice(i + 1, end);
            if (inner.trim()) {
              flush();
              nodes.push({
                type: "emphasis",
                children: parseInline(inner, depth + 1),
              });
              i = end + 1;
              continue;
            }
          }
        }
      }
    }

    if (char === "~" && text[i + 1] === "~" && depth < 5) {
      const end = text.indexOf("~~", i + 2);
      if (end !== -1 && end > i + 2 && text.slice(i + 2, end).trim()) {
        flush();
        nodes.push({
          type: "strike",
          children: parseInline(text.slice(i + 2, end), depth + 1),
        });
        i = end + 2;
        continue;
      }
    }

    if (char === "[") {
      const closeBracket = text.indexOf("]", i + 1);
      if (closeBracket !== -1 && text[closeBracket + 1] === "(") {
        const closeParen = text.indexOf(")", closeBracket + 2);
        if (closeParen !== -1) {
          const label = text.slice(i + 1, closeBracket);
          const href = text
            .slice(closeBracket + 2, closeParen)
            .trim()
            .split(/\s+/)[0];

          if (label && href) {
            flush();
            nodes.push({
              type: "link",
              href,
              children: parseInline(label, depth + 1),
            });
            i = closeParen + 1;
            continue;
          }
        }
      }
    }

    if (char === "<") {
      const autolink = /^<(https?:\/\/[^>\s]+)>/.exec(text.slice(i));
      if (autolink) {
        flush();
        nodes.push({
          type: "link",
          href: autolink[1],
          children: [{ type: "text", value: autolink[1] }],
        });
        i += autolink[0].length;
        continue;
      }
    }

    plain += char;
    i += 1;
  }

  flush();
  return nodes;
}

function isBlockStart(lines, index) {
  const line = lines[index];
  if (!line) return false;

  if (/^\s*(`{3,}|~{3,})/.test(line)) return true;
  if (/^#{1,6}\s/.test(line)) return true;
  if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) return true;
  if (/^\s{0,3}>/.test(line)) return true;
  if (LIST_RE.test(line)) return true;

  if (
    line.includes("|") &&
    index + 1 < lines.length &&
    lines[index + 1].includes("-") &&
    /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(
      lines[index + 1],
    )
  ) {
    return true;
  }

  return false;
}

function splitTableRow(line) {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);

  const cells = [];
  let current = "";

  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed[i] === "\\" && trimmed[i + 1] === "|") {
      current += "|";
      i += 1;
      continue;
    }
    if (trimmed[i] === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += trimmed[i];
  }

  cells.push(current.trim());
  return cells;
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

function parseList(lines, start) {
  const first = LIST_RE.exec(lines[start]);
  const ordered = /\d/.test(first[2]);
  const baseIndent = first[1].length;
  const items = [];
  let i = start;

  while (i < lines.length) {
    if (!lines[i].trim()) {
      let lookahead = i;
      while (lookahead < lines.length && !lines[lookahead].trim()) {
        lookahead += 1;
      }

      const next = lookahead < lines.length ? LIST_RE.exec(lines[lookahead]) : null;

      if (
        lookahead > i &&
        next &&
        next[1].length === baseIndent &&
        /\d/.test(next[2]) === ordered
      ) {
        i = lookahead;
        continue;
      }

      break;
    }

    const match = LIST_RE.exec(lines[i]);
    if (!match || match[1].length !== baseIndent) break;
    if (/\d/.test(match[2]) !== ordered) break;

    const prefixLength = match[0].length - match[3].length;
    const itemLines = [match[3]];
    i += 1;

    while (i < lines.length) {
      const next = lines[i];

      if (!next.trim()) {
        let lookahead = i;
        while (lookahead < lines.length && !lines[lookahead].trim()) {
          lookahead += 1;
        }

        if (
          lookahead < lines.length &&
          indentOf(lines[lookahead]) >= prefixLength
        ) {
          itemLines.push("");
          i += 1;
          continue;
        }
        break;
      }

      if (indentOf(next) >= prefixLength) {
        itemLines.push(next.slice(prefixLength));
        i += 1;
        continue;
      }

      if (LIST_RE.test(next)) break;

      const previous = itemLines[itemLines.length - 1];
      if (previous && previous.trim() && !isBlockStart(lines, i)) {
        itemLines.push(next.trim());
        i += 1;
        continue;
      }

      break;
    }

    items.push({ children: parseMarkdown(itemLines.join("\n")) });
  }

  return { type: "list", ordered, items, next: i };
}

function parseTable(lines, start) {
  const header = splitTableRow(lines[start]);
  const alignCells = splitTableRow(lines[start + 1]);
  const align = alignCells.map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });

  const rows = [];
  let i = start + 2;

  while (
    i < lines.length &&
    lines[i].trim() &&
    lines[i].includes("|") &&
    !isBlockStart(lines, i)
  ) {
    rows.push(splitTableRow(lines[i]));
    i += 1;
  }

  return { type: "table", header, align, rows, next: i };
}

export function parseMarkdown(text) {
  if (typeof text !== "string" || !text.trim()) return [];

  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/.exec(line);
    if (fence) {
      const marker = fence[1][0];
      const length = fence[1].length;
      const language = fence[2] ? fence[2].slice(0, 24) : "";
      const body = [];
      i += 1;

      while (i < lines.length) {
        const closing = new RegExp(
          `^\\s*${marker === "`" ? "`" : "~"}{${length},}\\s*$`,
        );
        if (closing.test(lines[i])) {
          i += 1;
          break;
        }
        body.push(lines[i]);
        i += 1;
      }

      blocks.push({ type: "code", language, value: body.join("\n") });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        children: parseInline(heading[2]),
      });
      i += 1;
      continue;
    }

    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: "rule" });
      i += 1;
      continue;
    }

    if (/^\s{0,3}>/.test(line)) {
      const inner = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) {
        inner.push(lines[i].replace(/^\s{0,3}>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "quote", children: parseMarkdown(inner.join("\n")) });
      continue;
    }

    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      lines[i + 1].includes("-") &&
      /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(
        lines[i + 1],
      )
    ) {
      const table = parseTable(lines, i);
      blocks.push(table);
      i = table.next;
      continue;
    }

    if (LIST_RE.test(line)) {
      const list = parseList(lines, i);
      blocks.push(list);
      i = Math.max(list.next, i + 1);
      continue;
    }

    const paragraph = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines, i)) {
      paragraph.push(lines[i].trim());
      i += 1;
    }

    if (paragraph.length > 0) {
      blocks.push({
        type: "paragraph",
        children: parseInline(paragraph.join("\n")),
      });
    } else {
      i += 1;
    }
  }

  return blocks;
}
