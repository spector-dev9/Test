import { validateFilePatch } from "./files.js";

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;
const HUNK_HEADER_RE =
  /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

export function parseUnifiedPatch(patch) {
  if (typeof patch !== "string" || !patch) return [];

  const lines = patch.replace(/\r\n?/g, "\n").split("\n");
  const hunks = [];
  let index = 0;

  while (index < lines.length) {
    const header = HUNK_RE.exec(lines[index]);
    if (!header) {
      index += 1;
      continue;
    }

    const hunk = {
      oldStart: Number(header[1]),
      newStart: Number(header[2]),
      oldNo: Number(header[1]),
      newNo: Number(header[2]),
      context: (header[3] ?? "").trim(),
      rows: [],
      removed: [],
      added: [],
    };

    index += 1;

    const flush = () => {
      const pairs = Math.max(hunk.removed.length, hunk.added.length);

      for (let i = 0; i < pairs; i += 1) {
        const left = hunk.removed[i] ?? null;
        const right = hunk.added[i] ?? null;

        hunk.rows.push({
          kind: left && right ? "change" : left ? "remove" : "add",
          left,
          right,
        });
      }

      hunk.removed = [];
      hunk.added = [];
    };

    while (index < lines.length) {
      const line = lines[index];

      if (line.startsWith("@@") || line.startsWith("diff ")) break;

      if (
        line.startsWith("--- ") &&
        lines[index + 1] !== undefined &&
        lines[index + 1].startsWith("+++ ")
      ) {
        break;
      }

      const marker = line.length === 0 ? " " : line[0];
      const text = line.slice(1);

      if (marker === "\\") {
        index += 1;
        continue;
      }

      if (marker === "-") {
        hunk.removed.push({ no: hunk.oldNo, text });
        hunk.oldNo += 1;
      } else if (marker === "+") {
        hunk.added.push({ no: hunk.newNo, text });
        hunk.newNo += 1;
      } else {
        const contextText = marker === " " ? text : line;

        flush();
        hunk.rows.push({
          kind: "context",
          left: { no: hunk.oldNo, text: contextText },
          right: { no: hunk.newNo, text: contextText },
        });
        hunk.oldNo += 1;
        hunk.newNo += 1;
      }

      index += 1;
    }

    flush();
    hunks.push(hunk);
  }

  return hunks;
}

export function summarizePatchStats(hunks) {
  if (!Array.isArray(hunks)) return { additions: 0, deletions: 0 };

  let additions = 0;
  let deletions = 0;

  for (const hunk of hunks) {
    for (const row of hunk.rows) {
      if (row.kind === "add") additions += 1;
      else if (row.kind === "remove") deletions += 1;
      else if (row.kind === "change") {
        additions += 1;
        deletions += 1;
      }
    }
  }

  return { additions, deletions };
}

function hunkLineCount(value) {
  return value === undefined ? 1 : Number(value);
}

/**
 * Build the patch that undoes a single-file unified diff.
 *
 * `vcs.apply` only accepts a forward patch, so reverting a changed file means
 * swapping the old/new sides and every added/removed line. Added files become
 * deletions and deleted files become additions.
 */
export function reverseUnifiedPatch(patch) {
  if (typeof patch !== "string" || !patch) return "";

  const source = patch.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  const parsed = validateFilePatch(source);
  if (!parsed) return "";

  const { path, isNew, isDeleted = false } = parsed;

  const lines = source.split("\n");
  const output = [`diff --git a/${path} b/${path}`];

  if (isNew) output.push("deleted file mode 100644");
  else if (isDeleted) output.push("new file mode 100644");

  output.push(`--- ${isNew ? `a/${path}` : "/dev/null"}`);
  output.push(`+++ ${isDeleted ? `b/${path}` : "/dev/null"}`);

  if (!isNew && !isDeleted) {
    output[output.length - 2] = `--- a/${path}`;
    output[output.length - 1] = `+++ b/${path}`;
  }

  let hunks = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const header = HUNK_HEADER_RE.exec(lines[index]);
    if (!header) continue;

    const oldStart = Number(header[1]);
    const oldCount = hunkLineCount(header[2]);
    const newStart = Number(header[3]);
    const newCount = hunkLineCount(header[4]);
    const context = header[5] ?? "";

    hunks += 1;
    output.push(
      `@@ -${newStart},${newCount} +${oldStart},${oldCount} @@${context}`,
    );

    index += 1;
    while (index < lines.length) {
      const line = lines[index];
      if (line.startsWith("@@") || line.startsWith("diff --git ")) {
        index -= 1;
        break;
      }

      if (line.startsWith("+")) {
        output.push(`-${line.slice(1)}`);
      } else if (line.startsWith("-")) {
        output.push(`+${line.slice(1)}`);
      } else {
        output.push(line);
      }

      index += 1;
    }
  }

  return hunks > 0 ? `${output.join("\n")}\n` : "";
}
