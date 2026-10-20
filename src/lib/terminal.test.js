import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_TERMINAL_COMMAND_CHARS,
  MAX_TERMINAL_LINE_CHARS,
  MAX_TERMINAL_LINES,
  appendTerminalLine,
  extractTerminalOutput,
  normalizeTerminalOutput,
  validateTerminalCommand,
} from "./terminal.js";

test("validates single-line terminal commands", () => {
  assert.equal(validateTerminalCommand("  git status  "), "git status");
  assert.equal(validateTerminalCommand("printf a\0b"), null);
  assert.equal(validateTerminalCommand(""), null);
  assert.equal(validateTerminalCommand("x".repeat(MAX_TERMINAL_COMMAND_CHARS + 1)), null);
  assert.equal(validateTerminalCommand(null), null);
});

test("normalizes terminal output and strips escape sequences", () => {
  assert.equal(
    normalizeTerminalOutput("\u001b[32mgreen\u001b[0m\r\nnext\r\n\r\n"),
    "green\nnext",
  );
  assert.equal(normalizeTerminalOutput(undefined), "");
});

test("extracts tool output from a shell response", () => {
  assert.deepEqual(
    extractTerminalOutput({
      info: { id: "msg_1" },
      parts: [
        {
          type: "tool",
          tool: "bash",
          state: {
            status: "completed",
            output: "hello\n",
            metadata: { output: "hello\n" },
          },
        },
      ],
    }),
    { output: "hello", failed: false },
  );

  assert.deepEqual(
    extractTerminalOutput({
      parts: [
        {
          type: "tool",
          state: { status: "error", error: "command failed" },
        },
      ],
    }),
    { output: "command failed", failed: true },
  );

  assert.deepEqual(extractTerminalOutput(null), {
    output: "",
    failed: false,
  });
});

test("falls back to text parts when no tool output exists", () => {
  assert.deepEqual(
    extractTerminalOutput({
      parts: [{ type: "text", text: "fallback" }],
    }),
    { output: "fallback", failed: false },
  );
});

test("caps retained terminal lines", () => {
  let lines = [];
  for (let index = 0; index < MAX_TERMINAL_LINES + 5; index += 1) {
    lines = appendTerminalLine(lines, {
      id: String(index),
      kind: "output",
      text: String(index),
    });
  }

  assert.equal(lines.length, MAX_TERMINAL_LINES);
  assert.equal(lines[0].text, "5");
  assert.equal(lines.at(-1).text, String(MAX_TERMINAL_LINES + 4));
});

test("caps the size of a retained terminal line", () => {
  const lines = appendTerminalLine([], {
    id: "long",
    kind: "output",
    text: "x".repeat(MAX_TERMINAL_LINE_CHARS + 20),
  });

  assert.equal(lines[0].text.length, MAX_TERMINAL_LINE_CHARS);
});
