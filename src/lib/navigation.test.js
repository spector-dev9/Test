import assert from "node:assert/strict";
import test from "node:test";
import {
  BACK_ACTIONS,
  previousView,
  resolveBackAction,
} from "./navigation.js";

test("back closes the workspace menu first", () => {
  assert.equal(
    resolveBackAction({ menuOpen: true, activeView: "files" }),
    BACK_ACTIONS.CLOSE_MENU,
  );
});

test("back never leaves the app while the runtime gate is visible", () => {
  assert.equal(
    resolveBackAction({ serverGateVisible: true, activeView: "chat" }),
    BACK_ACTIONS.NONE,
  );
});

test("back dismisses an open dialog before navigating", () => {
  assert.equal(
    resolveBackAction({ modalOpen: true, activeView: "files" }),
    BACK_ACTIONS.DISMISS_MODAL,
  );
});

test("back restores a fullscreen surface before leaving the view", () => {
  assert.equal(
    resolveBackAction({ fullscreen: true, activeView: "preview" }),
    BACK_ACTIONS.EXIT_FULLSCREEN,
  );
});

test("back returns to the previous workspace view", () => {
  assert.equal(
    resolveBackAction({ activeView: "files" }),
    BACK_ACTIONS.NAVIGATE_BACK,
  );
});

test("back clears an unsent prompt before closing the app", () => {
  assert.equal(
    resolveBackAction({ activeView: "chat", hasDraft: true }),
    BACK_ACTIONS.CLEAR_DRAFT,
  );
  assert.equal(
    resolveBackAction({ activeView: "chat", hasDraft: false }),
    BACK_ACTIONS.EXIT_APP,
  );
});

test("back falls back to the chat view when there is no history", () => {
  assert.equal(previousView([], "files"), null);
  assert.equal(previousView(["chat", "files"], "files"), "chat");
  assert.equal(previousView(["files", "files"], "files"), null);
  assert.equal(previousView(null, "files"), null);
});
