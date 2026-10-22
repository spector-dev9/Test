export const PTY_ID_PATTERN = /^pty_[A-Za-z0-9]+$/;
export const MAX_PTY_TITLE_CHARS = 120;
export const MAX_TERMINAL_COLS = 400;
export const MAX_TERMINAL_ROWS = 200;

export function isPtyId(value) {
  return typeof value === "string" && PTY_ID_PATTERN.test(value);
}

export function normalizePtyTitle(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "OpenCode Terminal";
  }

  return value.trim().slice(0, MAX_PTY_TITLE_CHARS);
}

function normalizeCwd(value) {
  if (typeof value !== "string" || !value.startsWith("/")) return "";
  return value.length > 1 ? value.replace(/\/+$/, "") : value;
}

function androidCwdAlias(value) {
  const match = /^\/data\/(?:data|user\/0)\/([^/]+)(\/.*)?$/.exec(value);
  if (!match) return null;
  return `${match[1]}${match[2] ?? ""}`;
}

/**
 * Android exposes app data under both `/data/data/<pkg>` and
 * `/data/user/0/<pkg>`, and `File.getCanonicalPath()` may return either one.
 * The PTY server reports its canonical cwd, so compare the aliases instead of
 * rejecting a valid terminal created for the project.
 */
export function ptyCwdMatches(actual, expected) {
  const left = normalizeCwd(actual);
  const right = normalizeCwd(expected);
  if (!left || !right) return false;
  if (left === right) return true;

  const leftAlias = androidCwdAlias(left);
  const rightAlias = androidCwdAlias(right);
  return Boolean(leftAlias && rightAlias && leftAlias === rightAlias);
}

export function normalizePtyInfo(data, directory) {
  if (
    !data ||
    typeof data !== "object" ||
    !isPtyId(data.id) ||
    typeof data.title !== "string" ||
    typeof data.command !== "string" ||
    !data.command ||
    !Array.isArray(data.args) ||
    data.args.some((argument) => typeof argument !== "string") ||
    !ptyCwdMatches(data.cwd, directory) ||
    !["running", "exited"].includes(data.status) ||
    !Number.isSafeInteger(data.pid) ||
    data.pid <= 0
  ) {
    return null;
  }

  return {
    id: data.id,
    title: data.title.slice(0, MAX_PTY_TITLE_CHARS),
    command: data.command,
    args: data.args.slice(0, 20),
    cwd: data.cwd,
    status: data.status,
    pid: data.pid,
  };
}

export function ptyWebSocketUrl(
  baseUrl,
  directory,
  ptyID,
  cursor = 0,
) {
  if (!isPtyId(ptyID)) {
    throw new TypeError("The terminal identifier is invalid.");
  }

  if (
    !Number.isSafeInteger(cursor) ||
    cursor < 0
  ) {
    throw new TypeError("The terminal cursor is invalid.");
  }

  const url = new URL(baseUrl);

  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else {
    throw new TypeError("The terminal server URL is invalid.");
  }

  url.pathname = `/pty/${ptyID}/connect`;
  url.search = "";
  url.hash = "";
  url.searchParams.set("directory", directory);
  url.searchParams.set("cursor", String(cursor));

  return url.toString();
}

export function parsePtyMessage(data) {
  if (typeof data === "string") {
    return { kind: "output", text: data };
  }

  const bytes =
    data instanceof Uint8Array
      ? data
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : null;

  if (!bytes || bytes.byteLength === 0) {
    return { kind: "ignore" };
  }

  if (bytes[0] === 0) {
    try {
      const meta = JSON.parse(
        new TextDecoder().decode(bytes.subarray(1)),
      );

      if (Number.isSafeInteger(meta?.cursor) && meta.cursor >= 0) {
        return { kind: "meta", cursor: meta.cursor };
      }
    } catch {
      return { kind: "ignore" };
    }

    return { kind: "ignore" };
  }

  return {
    kind: "output",
    text: new TextDecoder().decode(bytes),
  };
}

export function validateTerminalSize(cols, rows) {
  if (
    !Number.isSafeInteger(cols) ||
    !Number.isSafeInteger(rows) ||
    cols < 20 ||
    cols > MAX_TERMINAL_COLS ||
    rows < 5 ||
    rows > MAX_TERMINAL_ROWS
  ) {
    return null;
  }

  return { cols, rows };
}
