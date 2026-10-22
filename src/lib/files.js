const MAX_PROJECT_PATH_CHARS = 4096;
export const MAX_FILE_CONTENT_CHARS = 1_000_000;
export const MAX_PATCH_CHARS = 2_500_000;
export const MAX_FILE_SEARCH_RESULTS = 100;
export const MAX_FILE_TABS = 6;

const UNSAFE_PATCH_PATH = /["\\]/;

function hasControlCharacters(value, allowed = []) {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (allowed.includes(code)) continue;
    if (code < 32 || code === 127) return true;
  }

  return false;
}

export function normalizeProjectPath(value, { allowRoot = false } = {}) {
  if (typeof value !== "string" || value.length > MAX_PROJECT_PATH_CHARS) {
    return null;
  }

  let normalized = value.replace(/\/+$/, "");

  if (normalized === "" || normalized === ".") {
    return allowRoot ? "." : null;
  }

  if (normalized.startsWith("/") || hasControlCharacters(normalized)) {
    return null;
  }

  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) => !segment || segment === "." || segment === "..",
    )
  ) {
    return null;
  }

  return normalized;
}

export function normalizePatchPath(value) {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    UNSAFE_PATCH_PATH.test(value)
  ) {
    return null;
  }

  const path = normalizeProjectPath(value);
  if (
    !path ||
    path.split("/").some((segment) => segment.toLowerCase() === ".git")
  ) {
    return null;
  }

  return path;
}

export function isPatchableFilePath(value) {
  return Boolean(normalizePatchPath(value));
}

function splitFileLines(content) {
  if (content === "") {
    return { lines: [], trailingNewline: false };
  }

  const lines = content.split("\n");
  const trailingNewline = content.endsWith("\n");

  if (trailingNewline) lines.pop();

  return { lines, trailingNewline };
}

export function buildFilePatch({
  path,
  previousContent = "",
  nextContent = "",
  isNew = false,
}) {
  const safePath = normalizePatchPath(path);
  if (!safePath) {
    throw new TypeError("This file path cannot be changed safely.");
  }

  if (typeof previousContent !== "string" || typeof nextContent !== "string") {
    throw new TypeError("File contents must be text.");
  }

  if (nextContent.length > MAX_FILE_CONTENT_CHARS) {
    throw new TypeError("The file is too large to save from this app.");
  }

  if (isNew && nextContent === "") {
    throw new TypeError(
      "The OpenCode patch API cannot create an empty file. Add content first.",
    );
  }

  const previous = splitFileLines(previousContent);
  const next = splitFileLines(nextContent);
  const lines = [
    `diff --git a/${safePath} b/${safePath}`,
    ...(isNew ? ["new file mode 100644"] : []),
    `--- ${isNew ? "/dev/null" : `a/${safePath}`}`,
    `+++ b/${safePath}`,
    `@@ -${previous.lines.length === 0 ? "0,0" : `1,${previous.lines.length}`} +${
      next.lines.length === 0 ? "0,0" : `1,${next.lines.length}`
    } @@`,
  ];

  for (const line of previous.lines) {
    lines.push(`-${line}`);
  }

  if (previous.lines.length > 0 && !previous.trailingNewline) {
    lines.push("\\ No newline at end of file");
  }

  for (const line of next.lines) {
    lines.push(`+${line}`);
  }

  if (next.lines.length > 0 && !next.trailingNewline) {
    lines.push("\\ No newline at end of file");
  }

  const patch = `${lines.join("\n")}\n`;
  if (patch.length > MAX_PATCH_CHARS) {
    throw new TypeError("The change is too large to save from this app.");
  }

  return patch;
}

function patchHeaderValue(value) {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\r$/, "");
  return normalized.endsWith("\t") ? normalized.slice(0, -1) : normalized;
}

export function patchFilePath(patch) {
  if (typeof patch !== "string" || !patch) return null;

  const headers = [...patch.matchAll(/^diff --git (.+)$/gm)];
  if (headers.length !== 1) return null;

  const diffLine = patchHeaderValue(headers[0][1]);
  const oldHeader = patchHeaderValue(/^--- (.*)$/m.exec(patch)?.[1]);
  const newHeader = patchHeaderValue(/^\+\+\+ (.*)$/m.exec(patch)?.[1]);
  const candidate =
    newHeader && newHeader !== "/dev/null" && newHeader.startsWith("b/")
      ? newHeader.slice(2)
      : oldHeader && oldHeader !== "/dev/null" && oldHeader.startsWith("a/")
        ? oldHeader.slice(2)
        : "";
  const path = normalizePatchPath(candidate);

  if (!path || diffLine !== `a/${path} b/${path}`) return null;
  return path;
}

export function validateFilePatch(patch) {
  if (
    typeof patch !== "string" ||
    !patch ||
    patch.length > MAX_PATCH_CHARS ||
    hasControlCharacters(patch, [9, 10, 13])
  ) {
    return null;
  }

  const path = patchFilePath(patch);
  if (!path) return null;

  if (
    /^(?:rename|copy) (?:from|to) /m.test(patch) ||
    /^(?:old mode|new mode) /m.test(patch) ||
    /^GIT binary patch$/m.test(patch) ||
    /^Binary files /m.test(patch)
  ) {
    return null;
  }

  const fileModes = [...patch.matchAll(/^new file mode (.+)$/gm)];
  const deletedModes = [...patch.matchAll(/^deleted file mode (.+)$/gm)];
  if (
    fileModes.length > 1 ||
    deletedModes.length > 1 ||
    (fileModes.length === 1 && deletedModes.length === 1) ||
    (fileModes.length === 1 && fileModes[0][1] !== "100644") ||
    (deletedModes.length === 1 && deletedModes[0][1] !== "100644")
  ) {
    return null;
  }

  const isNew = fileModes.length === 1;
  const isDeleted = deletedModes.length === 1;
  const oldHeader = patchHeaderValue(/^--- (.*)$/m.exec(patch)?.[1]);
  const newHeader = patchHeaderValue(/^\+\+\+ (.*)$/m.exec(patch)?.[1]);

  if (
    newHeader !== (isDeleted ? "/dev/null" : `b/${path}`) ||
    oldHeader !== (isNew ? "/dev/null" : `a/${path}`)
  ) {
    return null;
  }

  if (!/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(patch)) {
    return null;
  }

  return {
    path,
    isNew,
    ...(isDeleted ? { isDeleted: true } : {}),
  };
}

export function detectLineEnding(content) {
  return typeof content === "string" && content.includes("\r\n")
    ? "\r\n"
    : "\n";
}

export function toEditorText(content, lineEnding = detectLineEnding(content)) {
  if (typeof content !== "string") return "";
  return lineEnding === "\r\n" ? content.replace(/\r\n?/g, "\n") : content;
}

export function fromEditorText(content, lineEnding = "\n") {
  if (typeof content !== "string") return "";
  return lineEnding === "\r\n"
    ? content.replace(/\r?\n/g, "\r\n")
    : content.replace(/\r\n?/g, "\n");
}

export function normalizeFileNodes(directory, rows) {
  if (!Array.isArray(rows)) return [];

  const root =
    typeof directory === "string"
      ? directory.replace(/\/+$/, "")
      : "";

  if (!root.startsWith("/")) return [];

  return rows
    .flatMap((row) => {
      if (!row || typeof row !== "object") return [];

      const path = normalizeProjectPath(row.path);
      const name =
        typeof row.name === "string" && row.name.trim()
          ? row.name.trim().slice(0, 300)
          : path?.split("/").pop();

      if (
        !path ||
        !name ||
        (row.type !== "file" && row.type !== "directory")
      ) {
        return [];
      }

      if (
        typeof row.absolute === "string" &&
        row.absolute !== `${root}/${path}` &&
        row.absolute !== `${root}/${path}/`
      ) {
        return [];
      }

      return [
        {
          name,
          path,
          type: row.type,
          ignored: row.ignored === true,
        },
      ];
    })
    .sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "directory" ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });
}

export function normalizeFileContent(data) {
  if (
    !data ||
    typeof data !== "object" ||
    (data.type !== "text" && data.type !== "binary")
  ) {
    throw new TypeError("The OpenCode server returned invalid file data.");
  }

  const result = {
    type: data.type,
    content: typeof data.content === "string" ? data.content : "",
    encoding:
      typeof data.encoding === "string" ? data.encoding.slice(0, 40) : null,
    mimeType:
      typeof data.mimeType === "string" ? data.mimeType.slice(0, 120) : null,
  };

  if (result.type === "text" && result.content.length > MAX_FILE_CONTENT_CHARS) {
    throw new TypeError(
      "This file is too large to open on mobile. Use the desktop app or a terminal.",
    );
  }

  return result;
}

export function fileLanguage(path) {
  const name = String(path ?? "").toLowerCase();
  const extension = name.includes(".") ? name.split(".").pop() : "";
  const labels = {
    c: "C",
    cc: "C++",
    cpp: "C++",
    css: "CSS",
    go: "Go",
    h: "C",
    hpp: "C++",
    html: "HTML",
    java: "Java",
    js: "JavaScript",
    json: "JSON",
    jsx: "JSX",
    kt: "Kotlin",
    kts: "Kotlin",
    md: "Markdown",
    mjs: "JavaScript",
    py: "Python",
    rb: "Ruby",
    rs: "Rust",
    sh: "Shell",
    sql: "SQL",
    swift: "Swift",
    toml: "TOML",
    ts: "TypeScript",
    tsx: "TSX",
    txt: "Text",
    xml: "XML",
    yaml: "YAML",
    yml: "YAML",
  };

  if (labels[extension]) return labels[extension];
  if (name.endsWith("dockerfile")) return "Dockerfile";
  if (name.includes("makefile")) return "Makefile";
  return extension ? extension.toUpperCase() : "Text";
}

export function basename(path) {
  return String(path ?? "").split("/").pop() || path || "File";
}
