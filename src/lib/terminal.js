export const MAX_TERMINAL_COMMAND_CHARS = 8000;
export const MAX_TERMINAL_LINE_CHARS = 100000;
export const MAX_TERMINAL_LINES = 500;
export const TERMINAL_SESSION_TITLE = "OpenCode Terminal";

const ANSI_ESCAPE = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-?]*[ -/]*[@-~]`, "g");

export function validateTerminalCommand(value) {
  if (typeof value !== "string") return null;

  const command = value.trim();
  if (
    !command ||
    command.length > MAX_TERMINAL_COMMAND_CHARS ||
    command.includes("\0")
  ) {
    return null;
  }

  return command;
}

export function normalizeTerminalOutput(value) {
  if (typeof value !== "string") return "";

  return value
    .replace(ANSI_PATTERN, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n+$/, "");
}

export function extractTerminalOutput(payload) {
  if (!payload || typeof payload !== "object") {
    return { output: "", failed: false };
  }

  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  const toolPart = parts.find(
    (part) =>
      part?.type === "tool" &&
      part.state &&
      typeof part.state === "object",
  );

  if (!toolPart) {
    const text = parts
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n");

    return { output: normalizeTerminalOutput(text), failed: false };
  }

  const state = toolPart.state;
  const rawOutput =
    state.output ??
    state.metadata?.output ??
    (typeof state.error === "string" ? state.error : "");

  return {
    output: normalizeTerminalOutput(rawOutput),
    failed: state.status === "error",
  };
}

export function appendTerminalLine(lines, line) {
  const next = [
    ...lines,
    {
      ...line,
      text:
        typeof line?.text === "string"
          ? line.text.slice(0, MAX_TERMINAL_LINE_CHARS)
          : "",
    },
  ];

  if (next.length <= MAX_TERMINAL_LINES) return next;

  return next.slice(next.length - MAX_TERMINAL_LINES);
}
