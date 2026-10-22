import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_SESSION_IMPORT_BYTES,
  createSingleFlight,
  formatTransferBytes,
  importSessionFromFile,
  isSessionTransferSupported,
  sessionExportFileName,
  validateSessionImportFile,
} from "./sessionTransfer.js";

test("sessionExportFileName matches the opencode slug style", () => {
  assert.equal(
    sessionExportFileName({ title: "OpenCode Mobile inspection and plan" }),
    "opencode-mobile-inspection-and-plan.json",
  );
  assert.equal(
    sessionExportFileName({ slug: "Happy Moon" }),
    "happy-moon.json",
  );
  assert.equal(
    sessionExportFileName({ id: "ses_ea982c5a9ffexJWHrNWJqXEun6" }),
    "ses_ea982c5a9ffexjwhrnwjqxeun6.json",
  );
});

test("sessionExportFileName survives empty and messy titles", () => {
  assert.equal(sessionExportFileName({}), "session.json");
  assert.equal(sessionExportFileName(null), "session.json");
  assert.equal(
    sessionExportFileName({ title: "  ---   !!!   ---  " }),
    "session.json",
  );
  assert.equal(
    sessionExportFileName({ title: "Ünïcode / Räumung" }),
    "unicode-raumung.json",
  );
  const long = sessionExportFileName({ title: "x".repeat(200) });
  assert.ok(long.length <= 69, `expected short name, got ${long.length}`);
});

test("formatTransferBytes renders human sizes", () => {
  assert.equal(formatTransferBytes(0), "0 B");
  assert.equal(formatTransferBytes(-5), "0 B");
  assert.equal(formatTransferBytes(undefined), "0 B");
  assert.equal(formatTransferBytes(1023), "1023 B");
  assert.equal(formatTransferBytes(1536), "1.5 KB");
  assert.equal(formatTransferBytes(1048576), "1 MB");
  assert.equal(formatTransferBytes(64558601), "61.6 MB");
});

test("session transfer is unavailable outside the Android app", () => {
  assert.equal(isSessionTransferSupported(), false);
});

test("rejects an oversized import before reading its contents", () => {
  assert.equal(validateSessionImportFile({ size: 1024 }).ok, true);
  assert.equal(
    validateSessionImportFile({ size: MAX_SESSION_IMPORT_BYTES }).ok,
    true,
  );

  const result = validateSessionImportFile({
    size: MAX_SESSION_IMPORT_BYTES + 1,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /64 MB/);
});

test("allows a missing size so native validation remains the fallback", () => {
  assert.equal(validateSessionImportFile({}).ok, true);
  assert.equal(validateSessionImportFile(null).ok, true);
});

test("only one transfer can be active at a time", () => {
  const guard = createSingleFlight();
  assert.equal(guard.begin(), true);
  assert.equal(guard.begin(), false);
  assert.equal(guard.active, true);
  guard.end();
  assert.equal(guard.begin(), true);
  guard.end();
  assert.equal(guard.active, false);
});

test("import failures are surfaced instead of being treated as success", async () => {
  await assert.rejects(
    importSessionFromFile({ uri: "content://session.json" }),
    /only available in the Android app/,
  );
});
