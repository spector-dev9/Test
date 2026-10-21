import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { CopilotRetryPlugin } from "../../android/app/src/main/assets/copilot-retry.js";

const originalFetch = globalThis.fetch;

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

async function createHooks() {
  return CopilotRetryPlugin(null, { retryDelays: [0] });
}

async function createLoader() {
  const hooks = await createHooks();
  return hooks.auth.loader(async () => ({
    type: "oauth",
    refresh: "copilot-token",
  }));
}

function chatRequest() {
  return new Request("https://api.githubcopilot.com/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      messages: [{ role: "user", content: "Hello" }],
    }),
  });
}

afterEach(restoreFetch);

test("preserves the Copilot OAuth method while overriding the loader", async () => {
  const hooks = await createHooks();

  assert.equal(hooks.auth.provider, "github-copilot");
  assert.equal(hooks.auth.methods.length, 1);
  assert.equal(hooks.auth.methods[0].type, "oauth");
  assert.equal(hooks.auth.methods[0].label, "Login with GitHub Copilot");
});

test("runs the GitHub device flow with the built-in Copilot client", async () => {
  const calls = [];
  const responses = [
    new Response(
      JSON.stringify({
        verification_uri: "https://github.com/login/device",
        user_code: "ABCD-1234",
        device_code: "device-code",
        interval: 0,
      }),
      { status: 200 },
    ),
    new Response(
      JSON.stringify({ access_token: "gho_test_token" }),
      { status: 200 },
    ),
  ];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return responses.shift();
  };

  const hooks = await createHooks();
  const authorization = await hooks.auth.methods[0].authorize({
    deploymentType: "github.com",
  });

  assert.equal(authorization.url, "https://github.com/login/device");
  assert.equal(authorization.instructions, "Enter code: ABCD-1234");
  assert.equal(authorization.method, "auto");

  const result = await authorization.callback();

  assert.deepEqual(result, {
    type: "success",
    refresh: "gho_test_token",
    access: "gho_test_token",
    expires: 0,
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /github\.com\/login\/device\/code$/);
  assert.match(calls[1].url, /github\.com\/login\/oauth\/access_token$/);
});

test("retries Copilot requests once after an expired token", async () => {
  let calls = 0;
  globalThis.fetch = async (_request, init) => {
    calls += 1;
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer copilot-token");
    assert.equal(headers.get("x-initiator"), "user");

    if (calls === 1) {
      return new Response("unauthorized: token expired", { status: 401 });
    }

    return new Response("ok", { status: 200 });
  };

  const loader = await createLoader();
  const response = await loader.fetch(chatRequest(), {
    headers: { "content-type": "application/json" },
  });

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ok");
  assert.equal(calls, 2);
});

test("retries Copilot 403 responses that report an expired token", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? new Response("unauthorized: token expired", { status: 403 })
      : new Response("ok", { status: 200 });
  };

  const loader = await createLoader();
  const response = await loader.fetch(chatRequest());

  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test("does not retry unrelated Copilot authorization failures", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("unauthorized: not licensed", { status: 403 });
  };

  const loader = await createLoader();
  const response = await loader.fetch(chatRequest());

  assert.equal(response.status, 403);
  assert.equal(calls, 1);
});
