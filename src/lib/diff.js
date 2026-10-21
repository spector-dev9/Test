const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

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
