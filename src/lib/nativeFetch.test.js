import assert from "node:assert/strict";
import test from "node:test";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import { CONNECTION_ERROR_KINDS } from "./connection.js";
import {
  createNativeFetch,
  MAX_RESPONSE_BYTES,
} from "./nativeFetch.js";
import { PROJECT_DIRECTORY } from "./project.js";

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

test("rejects non-GET methods before contacting Capacitor", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
    const http = createHttp();
    const nativeFetch = createNativeFetch(http);

    await assert.rejects(
      nativeFetch(HEALTH_URL, { method }),
      /only allows GET requests/,
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
      /project session directory/,
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
