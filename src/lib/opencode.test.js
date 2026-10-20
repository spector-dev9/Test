import assert from "node:assert/strict";
import test from "node:test";
import {
  CONNECTION_ERROR_KINDS,
} from "./connection.js";
import {
  createOpenCodeApi,
  PROJECT_DIRECTORY,
  unwrapOpenCodeResult,
  validateHealthPayload,
} from "./opencode.js";

test("classifies non-success HTTP results without exposing response bodies", () => {
  const body = { message: "secret server detail" };

  assert.throws(
    () =>
      unwrapOpenCodeResult(
        { error: body, response: { status: 503 } },
        "Fallback message.",
      ),
    (error) => {
      assert.equal(error.kind, CONNECTION_ERROR_KINDS.HTTP);
      assert.equal(error.status, 503);
      assert.equal(error.message, "The OpenCode server returned HTTP 503.");
      assert.doesNotMatch(error.message, /secret/);
      return true;
    },
  );
});

test("classifies transport failures as network errors", () => {
  assert.throws(
    () =>
      unwrapOpenCodeResult(
        { error: new TypeError("secret socket detail"), response: undefined },
        "Cannot reach the server.",
      ),
    (error) => {
      assert.equal(error.kind, CONNECTION_ERROR_KINDS.NETWORK);
      assert.equal(error.message, "Cannot reach the server.");
      assert.doesNotMatch(error.message, /secret/);
      return true;
    },
  );
});

test("classifies unhealthy and malformed health payloads separately", () => {
  assert.equal(
    validateHealthPayload({ healthy: true, version: "test" }).version,
    "test",
  );

  assert.throws(
    () => validateHealthPayload({ healthy: false }),
    (error) => error.kind === CONNECTION_ERROR_KINDS.UNHEALTHY,
  );

  for (const payload of [null, {}, { healthy: "yes" }]) {
    assert.throws(
      () => validateHealthPayload(payload),
      (error) => error.kind === CONNECTION_ERROR_KINDS.INVALID,
    );
  }
});

function fulfilled(data = null, status = 200) {
  return { data, response: { status } };
}

test("creates project sessions with validated model and title", async () => {
  const calls = [];
  const api = createOpenCodeApi({
    session: {
      create: async (body) => {
        calls.push(body);
        return fulfilled({
          id: "ses_test123",
          directory: PROJECT_DIRECTORY,
        });
      },
    },
  });

  const session = await api.createProjectSession({
    title: "  Mobile session  ",
    model: { providerID: "provider", modelID: "model" },
  });

  assert.equal(session.id, "ses_test123");
  assert.deepEqual(calls, [
    {
      directory: PROJECT_DIRECTORY,
      title: "Mobile session",
      model: { id: "model", providerID: "provider" },
    },
  ]);

  await assert.rejects(
    api.createProjectSession({
      title: "x",
      model: { providerID: "../bad", modelID: "model" },
    }),
    /selected model is invalid/,
  );

  const invalidApi = createOpenCodeApi({
    session: {
      create: async () =>
        fulfilled({ id: "ses_test123", directory: "/tmp/other" }),
    },
  });
  await assert.rejects(
    invalidApi.createProjectSession({ title: "x" }),
    /unexpected response/,
  );
});

test("scopes session lists and messages to the project", async () => {
  const sessions = [
    { id: "ses_one", directory: PROJECT_DIRECTORY },
    { id: "ses_two", directory: "/tmp/other" },
  ];
  const messageRows = [
    {
      info: { sessionID: "ses_one", role: "user" },
      parts: [{ type: "text", text: "hello" }],
    },
    {
      info: { sessionID: "ses_two", role: "user" },
      parts: [{ type: "text", text: "other" }],
    },
    { info: { sessionID: "ses_one", role: "user" } },
  ];
  const calls = [];
  const api = createOpenCodeApi({
    session: {
      list: async (parameters) => {
        calls.push(["list", parameters]);
        return fulfilled(sessions);
      },
      messages: async (parameters) => {
        calls.push(["messages", parameters]);
        return fulfilled(messageRows);
      },
    },
  });

  assert.deepEqual(await api.listProjectSessions(), [sessions[0]]);
  assert.deepEqual(await api.listSessionMessages("ses_one"), [messageRows[0]]);
  assert.deepEqual(calls, [
    ["list", { directory: PROJECT_DIRECTORY }],
    [
      "messages",
      {
        sessionID: "ses_one",
        directory: PROJECT_DIRECTORY,
        limit: 200,
      },
    ],
  ]);

  await assert.rejects(
    api.listSessionMessages("../ses_bad"),
    /session identifier is invalid/,
  );
});

test("sends prompts, commands, and abort requests with project scope", async () => {
  const calls = [];
  const api = createOpenCodeApi({
    session: {
      promptAsync: async (parameters) => {
        calls.push(["prompt", parameters]);
        return fulfilled(null, 204);
      },
      command: async (parameters) => {
        calls.push(["command", parameters]);
        return fulfilled({});
      },
      abort: async (parameters) => {
        calls.push(["abort", parameters]);
        return fulfilled(true);
      },
    },
  });

  await api.sendPromptAsync("ses_test123", {
    text: "  Inspect this project.  ",
    model: { providerID: "provider", modelID: "model" },
    agent: "build",
  });
  await api.sendCommand("ses_test123", {
    command: "init",
    arguments: "smaller",
    model: { providerID: "provider", modelID: "model" },
    agent: "build",
  });
  await api.abortSession("ses_test123");

  assert.deepEqual(calls, [
    [
      "prompt",
      {
        sessionID: "ses_test123",
        directory: PROJECT_DIRECTORY,
        parts: [{ type: "text", text: "Inspect this project." }],
        model: { providerID: "provider", modelID: "model" },
        agent: "build",
      },
    ],
    [
      "command",
      {
        sessionID: "ses_test123",
        directory: PROJECT_DIRECTORY,
        command: "init",
        arguments: "smaller",
        model: "provider/model",
        agent: "build",
      },
    ],
    ["abort", { sessionID: "ses_test123", directory: PROJECT_DIRECTORY }],
  ]);

  await assert.rejects(
    api.sendPromptAsync("ses_test123", { text: "   " }),
    /Enter a prompt/,
  );
  await assert.rejects(
    api.sendCommand("ses_test123", { command: "bad command" }),
    /selected command is invalid/,
  );
});

test("loads providers, commands, and VCS data with validated options", async () => {
  const calls = [];
  const api = createOpenCodeApi({
    config: {
      providers: async (parameters) => {
        calls.push(["providers", parameters]);
        return fulfilled({ providers: [{ id: "p" }], default: {} });
      },
    },
    command: {
      list: async (parameters) => {
        calls.push(["commands", parameters]);
        return fulfilled([{ name: "init" }]);
      },
    },
    vcs: {
      status: async (parameters) => {
        calls.push(["status", parameters]);
        return fulfilled([]);
      },
      diff: async (parameters) => {
        calls.push(["diff", parameters]);
        return fulfilled([]);
      },
    },
  });

  assert.deepEqual((await api.listProviders()).providers, [{ id: "p" }]);
  assert.deepEqual(await api.listCommands(), [{ name: "init" }]);
  assert.deepEqual(await api.getVcsStatus(), []);
  assert.deepEqual(await api.getVcsDiff({ mode: "branch", context: 5 }), []);

  assert.deepEqual(calls, [
    ["providers", { directory: PROJECT_DIRECTORY }],
    ["commands", { directory: PROJECT_DIRECTORY }],
    ["status", { directory: PROJECT_DIRECTORY }],
    [
      "diff",
      { directory: PROJECT_DIRECTORY, mode: "branch", context: 5 },
    ],
  ]);

  await assert.rejects(
    api.getVcsDiff({ mode: "working" }),
    /diff mode is invalid/,
  );
  await assert.rejects(
    api.getVcsDiff({ mode: "git", context: 99 }),
    /diff context is invalid/,
  );
});
