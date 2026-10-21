import assert from "node:assert/strict";
import test from "node:test";
import {
  canEmbedPreview,
  isLoopbackHost,
  isPrivatePreviewHost,
  parsePreviewUrl,
  readStoredPreviewCommand,
  readStoredPreviewUrl,
  storePreviewCommand,
  storePreviewUrl,
} from "./preview.js";

test("accepts and normalizes preview URLs", () => {
  const bare = parsePreviewUrl("localhost:3000");
  assert.equal(bare.ok, true);
  assert.equal(bare.url, "http://localhost:3000/");

  const https = parsePreviewUrl("  https://127.0.0.1:4097/app  ");
  assert.equal(https.ok, true);
  assert.equal(https.url, "https://127.0.0.1:4097/app");

  const ip = parsePreviewUrl("http://192.168.1.10:8080");
  assert.equal(ip.ok, true);
  assert.equal(ip.url, "http://192.168.1.10:8080/");
});

test("rejects empty, non-http, and credentialed URLs", () => {
  assert.equal(parsePreviewUrl("").ok, false);
  assert.equal(parsePreviewUrl("   ").ok, false);
  assert.equal(parsePreviewUrl(null).ok, false);
  assert.equal(parsePreviewUrl("file:///etc/passwd").ok, false);
  assert.equal(parsePreviewUrl("javascript:alert(1)").ok, false);
  assert.equal(parsePreviewUrl("http://user:pass@host.test/").ok, false);
  assert.equal(parsePreviewUrl("not a url at all ??").ok, false);
});

test("recognizes loopback hosts", () => {
  const loopback = [
    "localhost",
    "LOCALHOST",
    "app.localhost",
    "127.0.0.1",
    "127.0.0.53",
    "0.0.0.0",
    "::1",
    "[::1]",
  ];

  for (const host of loopback) {
    assert.equal(isLoopbackHost(host), true, host);
  }

  assert.equal(isLoopbackHost("10.0.0.1"), false);
  assert.equal(isLoopbackHost("example.com"), false);
  assert.equal(isLoopbackHost(""), false);
  assert.equal(isLoopbackHost(null), false);
});

test("classifies private hosts for embedding", () => {
  const privateHosts = [
    "localhost",
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.5",
    "169.254.1.1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
  ];

  for (const host of privateHosts) {
    assert.equal(isPrivatePreviewHost(host), true, host);
  }

  const publicHosts = [
    "example.com",
    "8.8.8.8",
    "172.32.0.1",
    "2001:4860:4860::8888",
    "",
  ];

  for (const host of publicHosts) {
    assert.equal(isPrivatePreviewHost(host), false, host);
  }
});

test("embeds only private parsed URLs", () => {
  assert.equal(canEmbedPreview("http://localhost:5173/"), true);
  assert.equal(canEmbedPreview("http://192.168.0.2:3000/"), true);
  assert.equal(canEmbedPreview("https://example.com/"), false);
  assert.equal(canEmbedPreview("definitely not a url"), false);
  assert.equal(canEmbedPreview(null), false);
});

test("round-trips preview URL and command preferences", () => {
  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };

  const hadWindow = typeof globalThis.window !== "undefined";
  const previous = globalThis.window;
  globalThis.window = { localStorage: storage };

  try {
    storePreviewUrl("http://localhost:5173/");
    assert.equal(readStoredPreviewUrl(), "http://localhost:5173/");

    storePreviewUrl(null);
    assert.equal(readStoredPreviewUrl(), null);

    storePreviewCommand("npm run dev");
    assert.equal(readStoredPreviewCommand(), "npm run dev");

    storePreviewCommand("");
    assert.equal(readStoredPreviewCommand(), "");

    store.set("opencode-mobile.preview-url", "x".repeat(2001));
    assert.equal(readStoredPreviewUrl(), null);
  } finally {
    if (hadWindow) globalThis.window = previous;
    else delete globalThis.window;
  }
});

test("falls back when window storage is unavailable", () => {
  delete globalThis.window;
  assert.equal(readStoredPreviewUrl(), null);
  assert.equal(readStoredPreviewCommand(), "");
  storePreviewUrl("http://localhost:1/");
  storePreviewCommand("ls");
});
