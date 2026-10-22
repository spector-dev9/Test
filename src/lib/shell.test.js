import assert from "node:assert/strict";
import test from "node:test";
import { caseSuggestion, commandHint, commandOutcome } from "./shell.js";

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

test("preserves command exit codes and timeout state", () => {
  assert.deepEqual(commandOutcome({ exitCode: 0, output: "ok\n" }), {
    ok: true,
    exitCode: 0,
    timedOut: false,
    output: "ok\n",
    durationMs: null,
    label: "Exit 0",
  });
  assert.equal(commandOutcome({ exitCode: 127, output: "not found" }).ok, false);
  assert.equal(commandOutcome({ exitCode: 127 }).label, "Exit 127");
  assert.equal(commandOutcome({ exitCode: 0, ok: false }).ok, false);
  assert.deepEqual(
    commandOutcome({ exitCode: 1, ok: true, output: "installed" }),
    {
      ok: true,
      exitCode: 1,
      timedOut: false,
      output: "installed",
      durationMs: null,
      label: "Exit 1 (verified)",
    },
  );

  const timeout = commandOutcome({ exitCode: 124, timedOut: true });
  assert.equal(timeout.ok, false);
  assert.equal(timeout.timedOut, true);
  assert.equal(timeout.label, "Timed out");
});

test("does not mistake a missing exit code for a timeout", () => {
  const outcome = commandOutcome({ output: "done", durationMs: 42 });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.durationMs, 42);
});
