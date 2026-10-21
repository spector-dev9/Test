import assert from "node:assert/strict";
import test from "node:test";
import {
  highlightCode,
  normalizeLanguage,
  tokensToText,
} from "./highlight.js";

test("normalizes language aliases and rejects unknown names", () => {
  assert.equal(normalizeLanguage("ts"), "typescript");
  assert.equal(normalizeLanguage("TSX"), "typescript");
  assert.equal(normalizeLanguage("js"), "javascript");
  assert.equal(normalizeLanguage("TypeScript"), "typescript");
  assert.equal(normalizeLanguage(" py "), "python");
  assert.equal(normalizeLanguage("sh"), "bash");
  assert.equal(normalizeLanguage("yml"), "yaml");
  assert.equal(normalizeLanguage("html"), "markup");
  assert.equal(normalizeLanguage("brainfuck"), null);
  assert.equal(normalizeLanguage(""), null);
  assert.equal(normalizeLanguage("   "), null);
  assert.equal(normalizeLanguage(null), null);
  assert.equal(normalizeLanguage("node"), "javascript");
  assert.equal(normalizeLanguage("node.js rocks"), null);
});

test("tokens round-trip back to the original code", () => {
  const samples = [
    ["javascript", "const x = 1; // note\nfunction f() { return `t${x}`; }"],
    ["python", "def f(n):\n    return n * 2  # double\n"],
    ["json", '{"a": [1, 2.5, true], "b": null}'],
    ["bash", 'echo "hi" && ls -la # comment'],
    ["css", ".a { color: #fff; }"],
    ["unknownlang", "plain text { with * symbols }"],
    ["", "no language at all"],
  ];

  for (const [language, code] of samples) {
    assert.equal(
      tokensToText(highlightCode(code, language)),
      code,
      `roundtrip failed for ${language || "<empty>"}`,
    );
  }
});

test("emits typed tokens for javascript", () => {
  const tokens = highlightCode('const s = "text"; // done', "javascript");
  const types = new Set(tokens.map((token) => token.type));

  assert.ok(types.has("keyword"));
  assert.ok(types.has("string"));
  assert.ok(types.has("comment"));
  assert.equal(tokensToText(tokens), 'const s = "text"; // done');
});

test("classifies diff lines by marker", () => {
  const tokens = highlightCode("+added\n-removed\n context", "diff");
  assert.deepEqual(
    tokens.map((token) => token.type),
    ["added", "removed", "plain"],
  );

  const meta = highlightCode("@@ -1,2 +1,2 @@\n--- a\n+++ b", "diff");
  assert.deepEqual(
    meta.map((token) => token.type),
    ["meta", "meta", "meta"],
  );
});

test("returns no tokens for empty or invalid code", () => {
  assert.deepEqual(highlightCode("", "javascript"), []);
  assert.deepEqual(highlightCode(null, "javascript"), []);
  assert.deepEqual(highlightCode(7, "javascript"), []);
});
