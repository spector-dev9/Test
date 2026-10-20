import assert from "node:assert/strict";
import test from "node:test";
import {
  CONNECTION_ERROR_KINDS,
} from "./connection.js";
import {
  unwrapOpenCodeResult,
  validateHealthPayload,
} from "./opencode.js";

test("classifies non-success HTTP results without exposing response bodies", () => {
  const body = { message: "secret server detail" };

  assert.throws(
    () =>
      unwrapOpenCodeResult(
        { error: body, response: { status: 503 } },
        "Fallback message.",
      ),
    (error) => {
      assert.equal(error.kind, CONNECTION_ERROR_KINDS.HTTP);
      assert.equal(error.status, 503);
      assert.equal(error.message, "The OpenCode server returned HTTP 503.");
      assert.doesNotMatch(error.message, /secret/);
      return true;
    },
  );
});

test("classifies transport failures as network errors", () => {
  assert.throws(
    () =>
      unwrapOpenCodeResult(
        { error: new TypeError("secret socket detail"), response: undefined },
        "Cannot reach the server.",
      ),
    (error) => {
      assert.equal(error.kind, CONNECTION_ERROR_KINDS.NETWORK);
      assert.equal(error.message, "Cannot reach the server.");
      assert.doesNotMatch(error.message, /secret/);
      return true;
    },
  );
});

test("classifies unhealthy and malformed health payloads separately", () => {
  assert.equal(
    validateHealthPayload({ healthy: true, version: "test" }).version,
    "test",
  );

  assert.throws(
    () => validateHealthPayload({ healthy: false }),
    (error) => error.kind === CONNECTION_ERROR_KINDS.UNHEALTHY,
  );

  for (const payload of [null, {}, { healthy: "yes" }]) {
    assert.throws(
      () => validateHealthPayload(payload),
      (error) => error.kind === CONNECTION_ERROR_KINDS.INVALID,
    );
  }
});
