import assert from "node:assert/strict";
import test from "node:test";
import {
  isPtyId,
  normalizePtyInfo,
  normalizePtyTitle,
  parsePtyMessage,
  ptyCwdMatches,
  ptyWebSocketUrl,
  validateTerminalSize,
} from "./pty.js";

const DIRECTORY = "/data/data/com.termux/files/home/projects/demo";
const PTY = {
  id: "pty_abc123XYZ",
  title: "OpenCode Terminal",
  command: "/bin/sh",
  args: ["-l"],
  cwd: DIRECTORY,
  status: "running",
  pid: 1234,
};

test("validates PTY identifiers and sizes", () => {
  assert.equal(isPtyId(PTY.id), true);
  assert.equal(isPtyId("pty_"), false);
  assert.equal(isPtyId("pty_bad-id"), false);
  assert.deepEqual(validateTerminalSize(80, 24), { cols: 80, rows: 24 });
  assert.equal(validateTerminalSize(5, 0), null);
  assert.equal(validateTerminalSize(401, 24), null);
});

test("normalizes PTY titles and metadata", () => {
  assert.equal(normalizePtyTitle("  build shell  "), "build shell");
  assert.equal(normalizePtyTitle(""), "OpenCode Terminal");
  assert.deepEqual(normalizePtyInfo(PTY, DIRECTORY), PTY);
  assert.equal(
    normalizePtyInfo({ ...PTY, cwd: "/tmp/elsewhere" }, DIRECTORY),
    null,
  );
  assert.equal(normalizePtyInfo({ ...PTY, pid: "1" }, DIRECTORY), null);
});

test("matches Android app-data cwd aliases and trailing slashes", () => {
  const project = "/data/data/com.opencode.mobile/files/workspace";
  const canonical = "/data/user/0/com.opencode.mobile/files/workspace/";

  assert.equal(ptyCwdMatches(canonical, project), true);
  assert.equal(ptyCwdMatches(`${project}/`, project), true);
  assert.equal(
    ptyCwdMatches("/data/user/0/com.other.app/files/workspace", project),
    false,
  );
  assert.equal(ptyCwdMatches("/root", project), false);
  assert.equal(ptyCwdMatches(null, project), false);

  assert.deepEqual(
    normalizePtyInfo({ ...PTY, cwd: canonical }, project),
    { ...PTY, cwd: canonical },
  );
});

test("builds loopback WebSocket URLs", () => {
  assert.equal(
    ptyWebSocketUrl("http://127.0.0.1:4096", DIRECTORY, PTY.id),
    `ws://127.0.0.1:4096/pty/${PTY.id}/connect?directory=${encodeURIComponent(DIRECTORY)}&cursor=0`,
  );
  assert.equal(
    ptyWebSocketUrl("https://localhost", DIRECTORY, PTY.id, 12),
    `wss://localhost/pty/${PTY.id}/connect?directory=${encodeURIComponent(DIRECTORY)}&cursor=12`,
  );
  assert.throws(() => ptyWebSocketUrl("http://127.0.0.1:4096", DIRECTORY, "bad"));
});

test("separates PTY output from cursor control frames", () => {
  assert.deepEqual(parsePtyMessage("hello"), {
    kind: "output",
    text: "hello",
  });

  const meta = new Uint8Array([
    0,
    ...new TextEncoder().encode('{"cursor":42}'),
  ]);
  assert.deepEqual(parsePtyMessage(meta), { kind: "meta", cursor: 42 });
  assert.deepEqual(parsePtyMessage(new Uint8Array([0])), { kind: "ignore" });
  assert.deepEqual(
    parsePtyMessage(new TextEncoder().encode("binary output")),
    { kind: "output", text: "binary output" },
  );
  assert.deepEqual(parsePtyMessage(new ArrayBuffer(0)), { kind: "ignore" });
});
