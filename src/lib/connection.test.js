import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_REQUEST_TIMEOUT_MS,
  CONNECTION_ERROR_KINDS,
  DEFAULT_OPENCODE_URL,
  NATIVE_OPENCODE_ORIGIN,
  OpenCodeConnectionError,
  connectionFailure,
  runWithTimeout,
  validateOpenCodeBaseUrl,
} from "./connection.js";

test("uses the loopback default for browser and native URLs", () => {
  assert.equal(DEFAULT_OPENCODE_URL, "http://127.0.0.1:4096");
  assert.equal(NATIVE_OPENCODE_ORIGIN, DEFAULT_OPENCODE_URL);
  assert.equal(validateOpenCodeBaseUrl(DEFAULT_OPENCODE_URL), null);
  assert.equal(
    validateOpenCodeBaseUrl(DEFAULT_OPENCODE_URL, { native: true }),
    null,
  );
});

test("rejects native URL configuration that conflicts with the allowlist", () => {
  const mismatches = [
    "http://localhost:4096",
    "http://127.0.0.1:4097",
    "https://127.0.0.1:4096",
    "http://127.0.0.1:4096/api",
    "http://127.0.0.1:4096/?probe=1",
  ];

  for (const baseUrl of mismatches) {
    const message = validateOpenCodeBaseUrl(baseUrl, { native: true });
    assert.match(message, /Native builds can only connect/);
  }

  assert.match(
    validateOpenCodeBaseUrl("http://user:pass@127.0.0.1:4096", {
      native: true,
    }),
    /must not contain credentials/,
  );
  assert.doesNotMatch(
    validateOpenCodeBaseUrl("http://user:pass@127.0.0.1:4096", {
      native: true,
    }),
    /user|pass/,
  );

  assert.equal(
    validateOpenCodeBaseUrl("http://localhost:4096", { native: false }),
    null,
  );
  assert.match(
    validateOpenCodeBaseUrl("ftp://127.0.0.1:4096", { native: true }),
    /HTTP or HTTPS/,
  );
});

test("times out browser requests and aborts their request signal", async () => {
  let requestSignal;
  const started = Date.now();

  await assert.rejects(
    runWithTimeout(
      (signal) => {
        requestSignal = signal;
        return new Promise(() => {});
      },
      { timeoutMs: 10 },
    ),
    (error) => {
      assert.ok(error instanceof OpenCodeConnectionError);
      assert.equal(error.kind, CONNECTION_ERROR_KINDS.TIMEOUT);
      return true;
    },
  );

  assert.equal(requestSignal.aborted, true);
  assert.ok(Date.now() - started < BROWSER_REQUEST_TIMEOUT_MS);
});

test("cancels pending requests when the caller aborts", async () => {
  const controller = new AbortController();
  let requestSignal;

  const pending = runWithTimeout(
    (signal) => {
      requestSignal = signal;
      return new Promise((_, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        );
      });
    },
    { signal: controller.signal, timeoutMs: 1000 },
  );

  setTimeout(() => controller.abort(), 5);

  await assert.rejects(pending, (error) => {
    assert.equal(error.kind, CONNECTION_ERROR_KINDS.ABORTED);
    return true;
  });
  assert.equal(requestSignal.aborted, true);
});

test("allows a successful retry after a timed-out request", async () => {
  await assert.rejects(
    runWithTimeout(() => new Promise(() => {}), { timeoutMs: 5 }),
    (error) => error.kind === CONNECTION_ERROR_KINDS.TIMEOUT,
  );

  const result = await runWithTimeout(async () => "recovered", {
    timeoutMs: 100,
  });

  assert.equal(result, "recovered");
});

test("returns only safe fallback details for unknown failures", () => {
  const failure = connectionFailure(
    new Error("secret response body"),
    "Something went wrong.",
  );

  assert.deepEqual(failure, {
    kind: CONNECTION_ERROR_KINDS.UNKNOWN,
    message: "Something went wrong.",
    status: undefined,
  });
  assert.doesNotMatch(failure.message, /secret/);
});
