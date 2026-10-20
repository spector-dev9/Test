import assert from "node:assert/strict";
import test from "node:test";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import { CONNECTION_ERROR_KINDS } from "./connection.js";
import { buildFilePatch } from "./files.js";
import {
  createNativeFetch,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
} from "./nativeFetch.js";
import { PROJECT_DIRECTORY } from "./project.js";
import {
  registerProjectDirectories,
  resetProjectDirectoryScope,
} from "./projectScope.js";

const HEALTH_URL = "http://127.0.0.1:4096/global/health";

function sessionUrl(directory = PROJECT_DIRECTORY) {
  const url = new URL("/session", "http://127.0.0.1:4096");
  url.searchParams.set("directory", directory);
  return url.href;
}

function createHttp(response = { status: 200, data: "{}", headers: {} }) {
  const calls = [];

  return {
    calls,
    request: async (options) => {
      calls.push(options);

      if (response instanceof Error) {
        throw response;
      }

      return response;
    },
  };
}

test("allows the exact health request and sanitizes response headers", async () => {
  const http = createHttp({
    status: 200,
    data: '{"healthy":true}',
    headers: {
      "content-type": "application/json",
      "content-length": "999",
      "content-encoding": "gzip",
      "x-test": "present",
    },
  });
  const nativeFetch = createNativeFetch(http);

  const response = await nativeFetch(HEALTH_URL);

  assert.equal(http.calls.length, 1);
  assert.equal(http.calls[0].url, HEALTH_URL);
  assert.equal(http.calls[0].method, "GET");
  assert.equal(http.calls[0].responseType, "text");
  assert.equal(http.calls[0].disableRedirects, true);
  assert.equal(await response.text(), '{"healthy":true}');
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(response.headers.get("content-length"), null);
  assert.equal(response.headers.get("content-encoding"), null);
  assert.equal(response.headers.get("x-test"), "present");
});

test("allows only the exact project session query", async () => {
  const http = createHttp({ status: 200, data: "[]", headers: {} });
  const nativeFetch = createNativeFetch(http);
  const url = sessionUrl();

  const response = await nativeFetch(url);

  assert.equal(http.calls.length, 1);
  assert.equal(http.calls[0].url, url);
  assert.equal(http.calls[0].method, "GET");
  assert.equal(await response.text(), "[]");
});

test("accepts the real SDK health and session request shapes", async () => {
  const calls = [];
  const http = {
    request: async (options) => {
      calls.push(options);

      if (options.url.endsWith("/global/health")) {
        return {
          status: 200,
          data: { healthy: true, version: "test" },
          headers: { "content-type": "application/json" },
        };
      }

      return {
        status: 200,
        data: [],
        headers: { "content-type": "application/json" },
      };
    },
  };
  const client = createOpencodeClient({
    baseUrl: "http://127.0.0.1:4096",
    fetch: createNativeFetch(http),
  });

  const health = await client.global.health();
  const sessions = await client.session.list({ directory: PROJECT_DIRECTORY });

  assert.equal(health.data.healthy, true);
  assert.deepEqual(sessions.data, []);
  assert.deepEqual(
    calls.map((call) => call.url),
    [HEALTH_URL, sessionUrl()],
  );
});

test("rejects unsupported methods before contacting Capacitor", async () => {
  for (const method of ["PUT", "OPTIONS", "HEAD"]) {
    const http = createHttp();
    const nativeFetch = createNativeFetch(http);

    await assert.rejects(
      nativeFetch(HEALTH_URL, { method }),
      /request method/,
    );
    assert.equal(http.calls.length, 0);
  }
});

test("rejects other origins, ports, methods, and paths", async () => {
  const urls = [
    "http://localhost:4096/global/health",
    "http://127.0.0.1:4097/global/health",
    "https://127.0.0.1:4096/global/health",
    "http://127.0.0.1:4096/global/health?probe=1",
    "http://127.0.0.1:4096/global/health#fragment",
    "http://127.0.0.1:4096/global/health/",
    "http://127.0.0.1:4096/session",
    "http://127.0.0.1:4096/session/",
    "http://user:pass@127.0.0.1:4096/global/health",
    "http://127.0.0.1:4096/experimental/session",
  ];

  for (const url of urls) {
    const http = createHttp();
    const nativeFetch = createNativeFetch(http);

    await assert.rejects(nativeFetch(url), TypeError);
    assert.equal(http.calls.length, 0);
  }
});

test("rejects missing, wrong, duplicate, or extra session parameters", async () => {
  const urls = [
    "http://127.0.0.1:4096/session",
    sessionUrl("/tmp"),
    `${sessionUrl()}&directory=${encodeURIComponent(PROJECT_DIRECTORY)}`,
    `${sessionUrl()}&limit=10`,
    `http://127.0.0.1:4096/session?workspace=${encodeURIComponent(PROJECT_DIRECTORY)}`,
  ];

  for (const url of urls) {
    const http = createHttp();
    const nativeFetch = createNativeFetch(http);

    await assert.rejects(
      nativeFetch(url),
      /(project directory|unsupported query parameter)/,
    );
    assert.equal(http.calls.length, 0);
  }
});

test("rejects redirects even if Capacitor returns one", async () => {
  const http = createHttp({
    status: 302,
    data: "",
    headers: { location: "http://127.0.0.1:4096/session" },
  });
  const nativeFetch = createNativeFetch(http);

  await assert.rejects(nativeFetch(HEALTH_URL), /rejected the response/);
  assert.equal(http.calls.length, 1);
  assert.equal(http.calls[0].disableRedirects, true);
});

test("rejects malformed response statuses", async () => {
  for (const response of [
    null,
    { status: "200", data: "{}", headers: {} },
    { status: 199, data: "{}", headers: {} },
    { status: 304, data: "", headers: {} },
    { status: 600, data: "{}", headers: {} },
  ]) {
    const nativeFetch = createNativeFetch(createHttp(response));

    await assert.rejects(nativeFetch(HEALTH_URL), TypeError);
  }
});

test("turns network failures into a generic TypeError", async () => {
  const nativeFetch = createNativeFetch(createHttp(new Error("socket detail")));

  await assert.rejects(nativeFetch(HEALTH_URL), (error) => {
    assert.ok(error instanceof TypeError);
    assert.doesNotMatch(error.message, /socket detail/);
    return true;
  });
});

test("classifies native timeouts without exposing transport details", async () => {
  const nativeFetch = createNativeFetch(
    createHttp(new Error("Connect timed out: secret detail")),
  );

  await assert.rejects(nativeFetch(HEALTH_URL), (error) => {
    assert.equal(error.kind, CONNECTION_ERROR_KINDS.TIMEOUT);
    assert.equal(error.message, "The OpenCode server did not respond in time.");
    assert.doesNotMatch(error.message, /secret/);
    return true;
  });
});

test("skips malformed response headers", async () => {
  const http = createHttp({
    status: 200,
    data: "{}",
    headers: {
      "x-good": "present",
      "bad header": "invalid",
      "x-newline": "a\nb",
    },
  });
  const nativeFetch = createNativeFetch(http);

  const response = await nativeFetch(HEALTH_URL);

  assert.equal(response.headers.get("x-good"), "present");
  assert.equal(response.headers.has("x-newline"), false);
  assert.equal([...response.headers.keys()].includes("bad header"), false);
});

test("rejects declared and actual bodies over the response limit", async () => {
  const declaredHttp = createHttp({
    status: 200,
    data: "{}",
    headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) },
  });
  await assert.rejects(
    createNativeFetch(declaredHttp)(HEALTH_URL),
    /response is too large/,
  );

  const actualHttp = createHttp({
    status: 200,
    data: "x".repeat(MAX_RESPONSE_BYTES + 1),
    headers: {},
  });
  await assert.rejects(
    createNativeFetch(actualHttp)(HEALTH_URL),
    /response is too large/,
  );
});

test("rejects malformed data and accepts bodyless 204 responses", async () => {
  const circular = {};
  circular.self = circular;

  const malformedHttp = createHttp({
    status: 200,
    data: circular,
    headers: {},
  });
  await assert.rejects(
    createNativeFetch(malformedHttp)(HEALTH_URL),
    /malformed data/,
  );

  const emptyHttp = createHttp({
    status: 204,
    data: "ignored",
    headers: {},
  });
  const response = await createNativeFetch(emptyHttp)(HEALTH_URL);
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
});

function sessionItemUrl(
  action,
  {
    sessionID = "ses_test123",
    directory = PROJECT_DIRECTORY,
    query = {},
  } = {},
) {
  const url = new URL(
    `/session/${sessionID}/${action}`,
    "http://127.0.0.1:4096",
  );
  url.searchParams.set("directory", directory);

  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value));
  }

  return url.href;
}

function fileUrl(pathname = "/file", path = ".") {
  const url = new URL(pathname, "http://127.0.0.1:4096");
  url.searchParams.set("directory", PROJECT_DIRECTORY);
  url.searchParams.set("path", path);
  return url.href;
}

function jsonRequest(body, method = "POST") {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function sessionResourceUrl(sessionID = "ses_test123") {
  const url = new URL(
    `/session/${sessionID}`,
    "http://127.0.0.1:4096",
  );
  url.searchParams.set("directory", PROJECT_DIRECTORY);
  return url.href;
}

function permissionReplyUrl(requestID = "perm_1") {
  const url = new URL(
    `/permission/${requestID}/reply`,
    "http://127.0.0.1:4096",
  );
  url.searchParams.set("directory", PROJECT_DIRECTORY);
  return url.href;
}

test("allows validated session create, prompt, command, and abort writes", async () => {
  const createHttpClient = createHttp({
    status: 200,
    data: { id: "ses_test123", directory: PROJECT_DIRECTORY },
    headers: { "content-type": "application/json" },
  });
  const createResponse = await createNativeFetch(createHttpClient)(
    sessionUrl(),
    jsonRequest({
      title: "Mobile session",
      model: { id: "model", providerID: "provider" },
    }),
  );
  assert.equal(createResponse.status, 200);
  assert.equal(createHttpClient.calls[0].method, "POST");
  assert.deepEqual(createHttpClient.calls[0].data, {
    title: "Mobile session",
    model: { id: "model", providerID: "provider" },
  });

  const promptHttp = createHttp({ status: 204, data: "", headers: {} });
  const promptResponse = await createNativeFetch(promptHttp)(
    sessionItemUrl("prompt_async"),
    jsonRequest({
      parts: [{ type: "text", text: "Inspect the project." }],
      model: { providerID: "provider", modelID: "model" },
      agent: "build",
    }),
  );
  assert.equal(promptResponse.status, 204);
  assert.deepEqual(promptHttp.calls[0].data, {
    parts: [{ type: "text", text: "Inspect the project." }],
    model: { providerID: "provider", modelID: "model" },
    agent: "build",
  });

  const commandHttp = createHttp({ status: 200, data: {}, headers: {} });
  await createNativeFetch(commandHttp)(
    sessionItemUrl("command"),
    jsonRequest({
      command: "init",
      arguments: "make it smaller",
      model: "provider/model",
      agent: "build",
    }),
  );
  assert.deepEqual(commandHttp.calls[0].data, {
    command: "init",
    arguments: "make it smaller",
    model: "provider/model",
    agent: "build",
  });

  const abortHttp = createHttp({ status: 200, data: true, headers: {} });
  await createNativeFetch(abortHttp)(
    sessionItemUrl("abort"),
    { method: "POST" },
  );
  assert.equal(abortHttp.calls[0].method, "POST");
  assert.equal(abortHttp.calls[0].data, undefined);
});

test("allows project discovery without a project query", async () => {
  const http = createHttp({
    status: 200,
    data: [{ id: "global", worktree: PROJECT_DIRECTORY }],
    headers: {},
  });
  const response = await createNativeFetch(http)(
    "http://127.0.0.1:4096/project",
  );

  assert.equal(response.status, 200);
  assert.equal(http.calls.length, 1);
  assert.equal(http.calls[0].method, "GET");

  const rejectedHttp = createHttp();
  await assert.rejects(
    createNativeFetch(rejectedHttp)(
      `http://127.0.0.1:4096/project?directory=${encodeURIComponent(PROJECT_DIRECTORY)}`,
    ),
    /project query/,
  );
  assert.equal(rejectedHttp.calls.length, 0);
});

test("allows a project directory only after discovery registers it", async (t) => {
  t.after(resetProjectDirectoryScope);

  const directory = "/tmp/discovered-project";
  const url = new URL("/session", "http://127.0.0.1:4096");
  url.searchParams.set("directory", directory);

  const unknownHttp = createHttp();
  await assert.rejects(
    createNativeFetch(unknownHttp)(url.href),
    /known project directory/,
  );
  assert.equal(unknownHttp.calls.length, 0);

  registerProjectDirectories([directory]);
  const knownHttp = createHttp({ status: 200, data: "[]", headers: {} });
  await createNativeFetch(knownHttp)(url.href);
  assert.equal(knownHttp.calls.length, 1);
});

test("allows scoped session updates, deletes, and permission replies", async () => {
  const updateHttp = createHttp({
    status: 200,
    data: { id: "ses_test123", directory: PROJECT_DIRECTORY },
    headers: { "content-type": "application/json" },
  });
  await createNativeFetch(updateHttp)(
    sessionResourceUrl(),
    jsonRequest({ title: "Renamed", time: { archived: 1234 } }, "PATCH"),
  );
  assert.equal(updateHttp.calls[0].method, "PATCH");
  assert.deepEqual(updateHttp.calls[0].data, {
    title: "Renamed",
    time: { archived: 1234 },
  });

  const deleteHttp = createHttp({ status: 200, data: true, headers: {} });
  await createNativeFetch(deleteHttp)(sessionResourceUrl(), {
    method: "DELETE",
  });
  assert.equal(deleteHttp.calls[0].method, "DELETE");

  const replyHttp = createHttp({ status: 200, data: true, headers: {} });
  await createNativeFetch(replyHttp)(
    permissionReplyUrl(),
    jsonRequest({ reply: "once", message: "approved" }),
  );
  assert.deepEqual(replyHttp.calls[0].data, {
    reply: "once",
    message: "approved",
  });
});

test("rejects invalid session updates and permission replies", async () => {
  const cases = [
    {
      url: sessionResourceUrl(),
      init: jsonRequest({}, "PATCH"),
    },
    {
      url: sessionResourceUrl(),
      init: jsonRequest({ time: { archived: -1 } }, "PATCH"),
    },
    {
      url: sessionResourceUrl(),
      init: jsonRequest({ time: { archived: "now" } }, "PATCH"),
    },
    {
      url: sessionResourceUrl(),
      init: jsonRequest({ title: "", extra: true }, "PATCH"),
    },
    {
      url: permissionReplyUrl(),
      init: jsonRequest({ reply: "yes" }),
    },
    {
      url: permissionReplyUrl(),
      init: jsonRequest({ reply: "once", message: "x".repeat(2001) }),
    },
    {
      url: permissionReplyUrl("bad id"),
      init: jsonRequest({ reply: "once" }),
    },
    {
      url: `${sessionResourceUrl()}?extra=1`,
      init: jsonRequest({ time: { archived: 1 } }, "PATCH"),
    },
  ];

  for (const item of cases) {
    const http = createHttp();
    await assert.rejects(
      createNativeFetch(http)(item.url, item.init),
      TypeError,
    );
    assert.equal(http.calls.length, 0);
  }
});

test("allows the phase 2 read endpoints", async () => {
  const urls = [
    "http://127.0.0.1:4096/permission?directory=" +
      encodeURIComponent(PROJECT_DIRECTORY),
    sessionItemUrl("message", { query: { limit: 200 } }),
    "http://127.0.0.1:4096/session/status?directory=" +
      encodeURIComponent(PROJECT_DIRECTORY),
    "http://127.0.0.1:4096/config/providers?directory=" +
      encodeURIComponent(PROJECT_DIRECTORY),
    "http://127.0.0.1:4096/command?directory=" +
      encodeURIComponent(PROJECT_DIRECTORY),
    "http://127.0.0.1:4096/vcs/status?directory=" +
      encodeURIComponent(PROJECT_DIRECTORY),
    "http://127.0.0.1:4096/vcs/diff?directory=" +
      encodeURIComponent(PROJECT_DIRECTORY) +
      "&mode=git&context=3",
  ];

  for (const url of urls) {
    const http = createHttp({ status: 200, data: "[]", headers: {} });
    const response = await createNativeFetch(http)(url);

    assert.equal(response.status, 200);
    assert.equal(http.calls.length, 1);
    assert.equal(http.calls[0].method, "GET");
  }
});

test("allows scoped file browsing, search, and safe patch writes", async () => {
  const findUrl = new URL(
    "/find/file",
    "http://127.0.0.1:4096",
  );
  findUrl.searchParams.set("directory", PROJECT_DIRECTORY);
  findUrl.searchParams.set("query", "App");
  findUrl.searchParams.set("type", "file");
  findUrl.searchParams.set("limit", "50");

  const reads = [
    fileUrl("/file", "."),
    fileUrl("/file/content", "src/App.jsx"),
    findUrl.href,
  ];

  for (const url of reads) {
    const http = createHttp({ status: 200, data: "[]", headers: {} });
    const response = await createNativeFetch(http)(url);

    assert.equal(response.status, 200);
    assert.equal(http.calls.length, 1);
    assert.equal(http.calls[0].method, "GET");
  }

  const patch = buildFilePatch({
    path: "src/example.js",
    previousContent: "one\n",
    nextContent: "two\n",
  });
  const applyUrl = new URL(
    "/vcs/apply",
    "http://127.0.0.1:4096",
  );
  applyUrl.searchParams.set("directory", PROJECT_DIRECTORY);

  const http = createHttp({ status: 200, data: "{}", headers: {} });
  await createNativeFetch(http)(applyUrl.href, jsonRequest({ patch }));

  assert.equal(http.calls.length, 1);
  assert.equal(http.calls[0].method, "POST");
  assert.deepEqual(http.calls[0].data, { patch });
});

test("rejects unsafe file paths, searches, and patches", async () => {
  const invalidUrls = [
    fileUrl("/file", "../secret"),
    fileUrl("/file/content", "/etc/passwd"),
    fileUrl("/file/content", "src/../secret"),
    fileUrl("/file", ".").replace("path=.", "path=.").concat("&extra=1"),
  ];

  const findUrl = new URL(
    "/find/file",
    "http://127.0.0.1:4096",
  );
  findUrl.searchParams.set("directory", PROJECT_DIRECTORY);
  findUrl.searchParams.set("query", "App");
  findUrl.searchParams.set("type", "directory");
  findUrl.searchParams.set("limit", "50");
  invalidUrls.push(findUrl.href);

  for (const url of invalidUrls) {
    const http = createHttp();
    await assert.rejects(createNativeFetch(http)(url), TypeError);
    assert.equal(http.calls.length, 0);
  }

  const applyUrl = new URL(
    "/vcs/apply",
    "http://127.0.0.1:4096",
  );
  applyUrl.searchParams.set("directory", PROJECT_DIRECTORY);

  const cases = [
    { patch: "" },
    { patch: "hello" },
    { patch: "diff --git a/../secret b/../secret\n", extra: true },
    {
      patch:
        "diff --git a/.git/config b/.git/config\n" +
        "--- a/.git/config\n" +
        "+++ b/.git/config\n" +
        "@@ -1,0 +1,1 @@\n" +
        "+unsafe\n",
    },
    {
      patch:
        "diff --git a/hook b/hook\n" +
        "new file mode 120000\n" +
        "--- /dev/null\n" +
        "+++ b/hook\n" +
        "@@ -0,0 +1,1 @@\n" +
        "+target\n",
    },
  ];

  for (const body of cases) {
    const http = createHttp();
    await assert.rejects(
      createNativeFetch(http)(applyUrl.href, jsonRequest(body)),
      TypeError,
    );
    assert.equal(http.calls.length, 0);
  }
});

test("rejects invalid write bodies, sessions, and oversized requests", async () => {
  const cases = [
    {
      url: sessionUrl(),
      body: { title: "", model: { id: "model", providerID: "provider" } },
    },
    {
      url: sessionUrl(),
      body: { title: "ok", extra: true },
    },
    {
      url: sessionUrl(),
      body: { title: "ok", model: { id: "../model", providerID: "provider" } },
    },
    {
      url: sessionItemUrl("prompt_async"),
      body: { parts: [] },
    },
    {
      url: sessionItemUrl("prompt_async"),
      body: {
        parts: [{ type: "text", text: "hi" }],
        tools: { bash: true },
      },
    },
    {
      url: sessionItemUrl("command"),
      body: { command: "bad command", arguments: "" },
    },
    {
      url: sessionItemUrl("command", { sessionID: "ses_bad-id" }),
      body: { command: "init", arguments: "" },
    },
    {
      url: sessionItemUrl("unknown"),
      body: { command: "init" },
    },
    {
      url: sessionItemUrl("prompt_async", {
        directory: "/tmp/elsewhere",
      }),
      body: { parts: [{ type: "text", text: "hi" }] },
    },
  ];

  for (const item of cases) {
    const http = createHttp();
    await assert.rejects(
      createNativeFetch(http)(item.url, jsonRequest(item.body)),
      TypeError,
    );
    assert.equal(http.calls.length, 0);
  }

  const oversizedHttp = createHttp();
  await assert.rejects(
    createNativeFetch(oversizedHttp)(
      sessionItemUrl("prompt_async"),
      jsonRequest({
        parts: [
          {
            type: "text",
            text: "x".repeat(MAX_REQUEST_BYTES + 1),
          },
        ],
      }),
    ),
    /oversized request/,
  );
  assert.equal(oversizedHttp.calls.length, 0);

  const nonJsonHttp = createHttp();
  await assert.rejects(
    createNativeFetch(nonJsonHttp)(sessionUrl(), {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "title",
    }),
    /JSON content type/,
  );
  assert.equal(nonJsonHttp.calls.length, 0);
});

test("rejects invalid read query combinations", async () => {
  const urls = [
    sessionItemUrl("message", { query: { limit: 500 } }),
    sessionItemUrl("message", { query: { before: "msg_1" } }),
    "http://127.0.0.1:4096/vcs/diff?directory=" +
      encodeURIComponent(PROJECT_DIRECTORY),
    "http://127.0.0.1:4096/vcs/diff?directory=" +
      encodeURIComponent(PROJECT_DIRECTORY) +
      "&mode=git&context=21",
    "http://127.0.0.1:4096/vcs/diff?directory=" +
      encodeURIComponent(PROJECT_DIRECTORY) +
      "&mode=working",
  ];

  for (const url of urls) {
    const http = createHttp();
    await assert.rejects(createNativeFetch(http)(url), TypeError);
    assert.equal(http.calls.length, 0);
  }
});

test("accepts the real SDK phase 2 request shapes", async () => {
  const calls = [];
  const http = {
    request: async (options) => {
      calls.push(options);
      const path = new URL(options.url).pathname;
      let data = [];

      if (path === "/session" && options.method === "POST") {
        data = {
          id: "ses_test123",
          directory: PROJECT_DIRECTORY,
          title: "SDK session",
        };
      } else if (path === "/config/providers") {
        data = { providers: [], default: {} };
      } else if (path === "/session/status") {
        data = {};
      } else if (path === "/project") {
        data = [{ id: "mobile", worktree: PROJECT_DIRECTORY }];
      } else if (path.startsWith("/session/") && options.method === "PATCH") {
        data = { id: sessionID, directory: PROJECT_DIRECTORY };
      } else if (path.startsWith("/session/") && options.method === "DELETE") {
        data = true;
      } else if (path.startsWith("/permission/")) {
        data = true;
      }

      return {
        status: 200,
        data,
        headers: { "content-type": "application/json" },
      };
    },
  };
  const client = createOpencodeClient({
    baseUrl: "http://127.0.0.1:4096",
    fetch: createNativeFetch(http),
  });
  const sessionID = "ses_test123";
  const model = { providerID: "provider", modelID: "model" };

  await client.session.create({
    directory: PROJECT_DIRECTORY,
    title: "SDK session",
    model: { id: model.modelID, providerID: model.providerID },
  });
  await client.session.promptAsync({
    sessionID,
    directory: PROJECT_DIRECTORY,
    model,
    parts: [{ type: "text", text: "Hello" }],
  });
  await client.session.command({
    sessionID,
    directory: PROJECT_DIRECTORY,
    command: "init",
    arguments: "",
    model: "provider/model",
  });
  await client.session.abort({ sessionID, directory: PROJECT_DIRECTORY });
  await client.session.messages({
    sessionID,
    directory: PROJECT_DIRECTORY,
    limit: 200,
  });
  await client.config.providers({ directory: PROJECT_DIRECTORY });
  await client.command.list({ directory: PROJECT_DIRECTORY });
  await client.vcs.status({ directory: PROJECT_DIRECTORY });
  await client.vcs.diff({
    directory: PROJECT_DIRECTORY,
    mode: "git",
    context: 3,
  });
  await client.project.list({});
  await client.session.update({
    sessionID,
    directory: PROJECT_DIRECTORY,
    title: "Renamed",
    time: { archived: 1234 },
  });
  await client.permission.list({ directory: PROJECT_DIRECTORY });
  await client.permission.reply({
    requestID: "perm_1",
    directory: PROJECT_DIRECTORY,
    reply: "once",
  });
  await client.session.delete({ sessionID, directory: PROJECT_DIRECTORY });

  assert.deepEqual(
    calls.map((call) => `${call.method} ${new URL(call.url).pathname}`),
    [
      "POST /session",
      `POST /session/${sessionID}/prompt_async`,
      `POST /session/${sessionID}/command`,
      `POST /session/${sessionID}/abort`,
      `GET /session/${sessionID}/message`,
      "GET /config/providers",
      "GET /command",
      "GET /vcs/status",
      "GET /vcs/diff",
      "GET /project",
      `PATCH /session/${sessionID}`,
      "GET /permission",
      "POST /permission/perm_1/reply",
      `DELETE /session/${sessionID}`,
    ],
  );

  for (const call of calls) {
    const url = new URL(call.url);
    if (url.pathname === "/project") {
      assert.equal(url.search, "");
      continue;
    }

    assert.equal(url.searchParams.get("directory"), PROJECT_DIRECTORY);
  }
});
