import assert from "node:assert/strict";
import test from "node:test";
import { retryDelayMs } from "../hooks/useOpenCodeProjects.js";

test("starts at the base delay for the first failures", () => {
  assert.equal(retryDelayMs(1), 2000);
  assert.equal(retryDelayMs(0), 2000);
  assert.equal(retryDelayMs(undefined), 2000);
  assert.equal(retryDelayMs(null), 2000);
});

test("doubles the delay on each consecutive failure", () => {
  assert.equal(retryDelayMs(1), 2000);
  assert.equal(retryDelayMs(2), 4000);
  assert.equal(retryDelayMs(3), 8000);
  assert.equal(retryDelayMs(4), 16000);
});

test("caps the delay at thirty seconds", () => {
  assert.equal(retryDelayMs(5), 30000);
  assert.equal(retryDelayMs(6), 30000);
  assert.equal(retryDelayMs(10_000), 30000);
});

test("stays monotonic across the whole range", () => {
  let previous = 0;

  for (let failures = 1; failures <= 12; failures += 1) {
    const delay = retryDelayMs(failures);
    assert.ok(Number.isFinite(delay), `delay for ${failures} is finite`);
    assert.ok(delay >= previous, `delay for ${failures} never decreases`);
    previous = delay;
  }
});

test("rejects garbage inputs without producing NaN", () => {
  assert.equal(retryDelayMs("many"), 2000);
  assert.equal(retryDelayMs(Number.NaN), 2000);
  assert.equal(retryDelayMs(-3), 2000);
  assert.equal(retryDelayMs(Number.POSITIVE_INFINITY), 2000);
  assert.equal(retryDelayMs("4"), 16000);
});
