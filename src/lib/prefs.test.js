import assert from "node:assert/strict";
import test from "node:test";
import {
  readStoredActiveView,
  readStoredSessionId,
  storeActiveView,
  storeSessionId,
} from "./prefs.js";

function withWindow(localStorage, run) {
  const hadWindow = typeof globalThis.window !== "undefined";
  const previous = globalThis.window;
  globalThis.window = { localStorage };

  try {
    run();
  } finally {
    if (hadWindow) globalThis.window = previous;
    else delete globalThis.window;
  }
}

function memoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    dump() {
      return Object.fromEntries(store);
    },
  };
}

test("falls back to chat and null when window is unavailable", () => {
  delete globalThis.window;
  assert.equal(readStoredActiveView(), "chat");
  assert.equal(readStoredSessionId(), null);
  storeActiveView("files");
  storeSessionId("ses_1");
});

test("round-trips a valid active view", () => {
  const storage = memoryStorage();

  withWindow(storage, () => {
    storeActiveView("files");
    assert.equal(readStoredActiveView(), "files");

    storeActiveView("terminal");
    assert.equal(readStoredActiveView(), "terminal");
    assert.deepEqual(storage.dump(), {
      "opencode-mobile.active-view": "terminal",
    });
  });
});

test("ignores unknown views when storing and reading", () => {
  const storage = memoryStorage({
    "opencode-mobile.active-view": "not-a-view",
  });

  withWindow(storage, () => {
    assert.equal(readStoredActiveView(), "chat");

    storeActiveView("nope");
    storeActiveView(null);
    storeActiveView(undefined);
    assert.equal(readStoredActiveView(), "chat");
  });
});

test("round-trips and clears the selected session", () => {
  const storage = memoryStorage();

  withWindow(storage, () => {
    storeSessionId("ses_abc123");
    assert.equal(readStoredSessionId(), "ses_abc123");

    storeSessionId(null);
    assert.equal(readStoredSessionId(), null);
  });
});

test("rejects oversized session ids on read", () => {
  const storage = memoryStorage({
    "opencode-mobile.selected-session": "s".repeat(201),
  });

  withWindow(storage, () => {
    assert.equal(readStoredSessionId(), null);
  });
});

test("surfaces a throwing storage layer as safe defaults", () => {
  const broken = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };

  withWindow(broken, () => {
    assert.equal(readStoredActiveView(), "chat");
    assert.equal(readStoredSessionId(), null);
    storeActiveView("settings");
    storeSessionId("ses_x");
  });
});
