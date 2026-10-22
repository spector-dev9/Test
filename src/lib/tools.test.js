import assert from "node:assert/strict";
import test from "node:test";
import {
  toolHasDetails,
  toolPreview,
  toolStateClass,
  toolStatusLabel,
} from "./tools.js";

test("maps tool states to display classes", () => {
  assert.equal(toolStateClass("completed"), "done");
  assert.equal(toolStateClass("error"), "failed");
  assert.equal(toolStateClass("failed"), "failed");
  assert.equal(toolStateClass("running"), "running");
  assert.equal(toolStateClass("pending"), "pending");
  assert.equal(toolStateClass("something-else"), "pending");
  assert.equal(toolStateClass(undefined), "pending");
});

test("labels tool states for the card header", () => {
  assert.equal(toolStatusLabel("completed"), "Done");
  assert.equal(toolStatusLabel("failed"), "Failed");
  assert.equal(toolStatusLabel("running"), "Running");
  assert.equal(toolStatusLabel("unknown"), "Pending");
});

test("builds a single line preview for collapsed tool output", () => {
  assert.equal(toolPreview("first\nsecond"), "first second");
  assert.equal(toolPreview("   "), "");
  assert.equal(toolPreview(null), "");
  assert.equal(toolPreview("x".repeat(200)).length, 161);
  assert.ok(toolPreview("x".repeat(200)).endsWith("…"));
});

test("knows when a tool card can be expanded", () => {
  assert.equal(toolHasDetails({ output: "result" }), true);
  assert.equal(toolHasDetails({ input: "{}" }), true);
  assert.equal(toolHasDetails({ error: "boom" }), true);
  assert.equal(toolHasDetails({ title: "Run tests" }), true);
  assert.equal(toolHasDetails({}), false);
  assert.equal(toolHasDetails(null), false);
});
