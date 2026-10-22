import assert from "node:assert/strict";
import test from "node:test";
import { boundaryCopy, errorDetail, fatalCopy } from "./errors.js";

test("describes a failure with a trimmed, capped message", () => {
  assert.equal(errorDetail(new Error("boom")), "boom");
  assert.equal(errorDetail(new Error("  boom  ")), "boom");
  assert.equal(
    errorDetail(new Error("x".repeat(500))).length,
    200,
  );
});

test("falls back to a readable message for unknown failures", () => {
  assert.equal(errorDetail(null), "An unexpected error occurred.");
  assert.equal(errorDetail(undefined), "An unexpected error occurred.");
  assert.equal(errorDetail({}), "An unexpected error occurred.");
  assert.equal(
    errorDetail(new Error(""), "custom fallback"),
    "custom fallback",
  );
});

test("names the surface that failed", () => {
  const copy = boundaryCopy("Chat", new Error("bad message"));
  assert.equal(copy.title, "Chat could not be displayed");
  assert.equal(copy.detail, "bad message");
  assert.match(copy.note, /still works/);
});

test("explains that a fatal error keeps the user's data", () => {
  const copy = fatalCopy(new Error("lost"));
  assert.equal(copy.kicker, "APP ERROR");
  assert.equal(copy.title, "OpenCode Mobile could not continue");
  assert.equal(copy.detail, "lost");
  assert.match(copy.note, /unchanged/);
});
