import assert from "node:assert/strict";
import test from "node:test";
import { caseSuggestion, commandHint } from "./shell.js";

test("spots a command that failed only because of capitalisation", () => {
  assert.equal(caseSuggestion("sh: Apk: not found"), "apk");
  assert.equal(caseSuggestion("sh: Pwd: not found"), "pwd");
  assert.equal(caseSuggestion("sh: Ls: not found"), "ls");
  assert.equal(
    caseSuggestion("sh: /usr/bin/env: 'Python': No such file or directory"),
    null,
  );
});

test("ignores output that is not a missing command", () => {
  assert.equal(caseSuggestion(""), null);
  assert.equal(caseSuggestion(null), null);
  assert.equal(caseSuggestion("sh: apk: not found"), null);
  assert.equal(caseSuggestion("everything worked"), null);
});

test("explains case sensitivity, apk usage, and a stale index", () => {
  assert.equal(
    commandHint("Apk update", "sh: Apk: not found"),
    "Shell commands are case-sensitive. Try: apk",
  );
  assert.match(
    commandHint("apt install curl", "sh: apt: not found"),
    /apk, not apt or pkg/,
  );
  assert.match(
    commandHint("apk add jq", "ERROR: unable to select packages"),
    /apk update/,
  );
  assert.equal(commandHint("ls", "README.md"), null);
});
