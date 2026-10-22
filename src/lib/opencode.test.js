import assert from "node:assert/strict";
import test from "node:test";
import {
  CONNECTION_ERROR_KINDS,
} from "./connection.js";
import {
  createOpenCodeApi,
  normalizeShellRequest,
  PROJECT_DIRECTORY,
  unwrapOpenCodeResult,
  validateHealthPayload,
} from "./opencode.js";
import { resetProjectDirectoryScope } from "./projectScope.js";

test("surfaces the server's HTTP failure reason and reference", () => {
  assert.throws(
    () =>
      unwrapOpenCodeResult(
        {
          error: {
            name: "UnknownError",
            data: {
              message: "Unexpected server error. Check server logs for details.",
              ref: "err_abc123",
            },
          },
          response: { status: 500 },
        },
        "Fallback message.",
      ),
    (error) => {
      assert.equal(error.kind, CONNECTION_ERROR_KINDS.HTTP);
      assert.equal(error.status, 500);
      assert.match(error.message, /Unexpected server error/);
      assert.match(error.message, /err_abc123/);
      return true;
    },
  );

  assert.throws(
    () =>
      unwrapOpenCodeResult(
        { error: { message: "Bad request" }, response: { status: 400 } },
        "Fallback message.",
      ),
    (error) => error.message === "Bad request",
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

test("discovers projects and allows their directories for scoped calls", async (t) => {
  t.after(resetProjectDirectoryScope);

  const calls = [];
  const api = createOpenCodeApi({
    project: {
      list: async (parameters) => {
        calls.push(["projects", parameters]);
        return fulfilled([
          {
            id: "global",
            worktree: "/data/data/com.termux/files/home/projects",
            name: " projects ",
          },
          {
            id: "mobile",
            worktree: "/tmp/mobile-project",
            vcs: "git",
          },
          { id: "bad", worktree: "relative/path" },
        ]);
      },
    },
    session: {
      list: async (parameters) => {
        calls.push(["sessions", parameters]);
        return fulfilled([]);
      },
    },
  });

  assert.deepEqual(await api.listProjects(), [
    {
      id: "global",
      worktree: "/data/data/com.termux/files/home/projects",
      name: "projects",
    },
    { id: "mobile", worktree: "/tmp/mobile-project", vcs: "git" },
  ]);
  await api.listProjectSessions("/tmp/mobile-project");

  assert.deepEqual(calls, [
    ["projects", {}],
    ["sessions", { directory: "/tmp/mobile-project" }],
  ]);

  await assert.rejects(
    api.listProjectSessions("/tmp/not-discovered"),
    /project directory is invalid/,
  );
});

test("updates, archives, and deletes scoped sessions", async () => {
  const calls = [];
  const api = createOpenCodeApi({
    session: {
      update: async (parameters) => {
        calls.push(["update", parameters]);
        return fulfilled({
          id: parameters.sessionID,
          directory: parameters.directory,
        });
      },
      delete: async (parameters) => {
        calls.push(["delete", parameters]);
        return fulfilled(true);
      },
    },
  });

  await api.updateSession(PROJECT_DIRECTORY, "ses_test123", {
    title: "  Renamed  ",
    archived: 1234,
  });
  await api.updateSession(PROJECT_DIRECTORY, "ses_test123", {
    archived: 0,
  });
  await api.deleteSession(PROJECT_DIRECTORY, "ses_test123");

  assert.deepEqual(calls, [
    [
      "update",
      {
        sessionID: "ses_test123",
        directory: PROJECT_DIRECTORY,
        title: "Renamed",
        time: { archived: 1234 },
      },
    ],
    [
      "update",
      {
        sessionID: "ses_test123",
        directory: PROJECT_DIRECTORY,
        time: { archived: 0 },
      },
    ],
    ["delete", { sessionID: "ses_test123", directory: PROJECT_DIRECTORY }],
  ]);

  await assert.rejects(
    api.updateSession(PROJECT_DIRECTORY, "ses_test123", {}),
    /No session changes/,
  );
  await assert.rejects(
    api.updateSession(PROJECT_DIRECTORY, "ses_test123", { archived: -1 }),
    /archive time is invalid/,
  );
  await assert.rejects(
    api.deleteSession(PROJECT_DIRECTORY, "../ses_bad"),
    /session identifier is invalid/,
  );
});

test("loads and replies to scoped permission requests", async () => {
  const calls = [];
  const api = createOpenCodeApi({
    permission: {
      list: async (parameters) => {
        calls.push(["list", parameters]);
        return fulfilled([
          {
            id: "perm_1",
            sessionID: "ses_test123",
            permission: " bash ",
            patterns: ["npm test", 42],
            always: ["npm run lint"],
          },
          {
            id: "bad id",
            sessionID: "ses_test123",
            permission: "bash",
          },
        ]);
      },
      reply: async (parameters) => {
        calls.push(["reply", parameters]);
        return fulfilled(true);
      },
    },
  });

  assert.deepEqual(await api.listPermissions(PROJECT_DIRECTORY), [
    {
      id: "perm_1",
      sessionID: "ses_test123",
      permission: "bash",
      patterns: ["npm test"],
      always: ["npm run lint"],
    },
  ]);

  await api.replyPermission(PROJECT_DIRECTORY, "perm_1", {
    reply: "once",
    message: "  approved  ",
  });
  await api.replyPermission(PROJECT_DIRECTORY, "perm_1", {
    reply: "reject",
  });

  assert.deepEqual(calls, [
    ["list", { directory: PROJECT_DIRECTORY }],
    [
      "reply",
      {
        requestID: "perm_1",
        directory: PROJECT_DIRECTORY,
        reply: "once",
        message: "approved",
      },
    ],
    [
      "reply",
      {
        requestID: "perm_1",
        directory: PROJECT_DIRECTORY,
        reply: "reject",
      },
    ],
  ]);

  await assert.rejects(
    api.replyPermission(PROJECT_DIRECTORY, "perm_1", { reply: "yes" }),
    /permission response is invalid/,
  );
});

test("loads, answers, and rejects scoped questions and todos", async () => {
  const calls = [];
  const api = createOpenCodeApi({
    question: {
      list: async (parameters) => {
        calls.push(["list", parameters]);
        return fulfilled([
          {
            id: "que_123",
            sessionID: "ses_test123",
            questions: [
              {
                question: "Which approach should I use?",
                header: "Approach",
                options: [
                  { label: "Existing API", description: "Reuse the client." },
                  { label: "New API", description: "Add a new endpoint." },
                ],
                multiple: false,
                custom: true,
              },
            ],
          },
          {
            id: "bad id",
            sessionID: "ses_test123",
            questions: [],
          },
        ]);
      },
      reply: async (parameters) => {
        calls.push(["reply", parameters]);
        return fulfilled(true);
      },
      reject: async (parameters) => {
        calls.push(["reject", parameters]);
        return fulfilled(true);
      },
    },
    session: {
      todo: async (parameters) => {
        calls.push(["todo", parameters]);
        return fulfilled([
          {
            content: "  Add tests  ",
            status: "in_progress",
            priority: "high",
          },
          { content: "", status: "pending", priority: "low" },
        ]);
      },
    },
  });

  assert.deepEqual(await api.listQuestions(PROJECT_DIRECTORY), [
    {
      id: "que_123",
      sessionID: "ses_test123",
      questions: [
        {
          question: "Which approach should I use?",
          header: "Approach",
          options: [
            { label: "Existing API", description: "Reuse the client." },
            { label: "New API", description: "Add a new endpoint." },
          ],
          multiple: false,
          custom: true,
        },
      ],
    },
  ]);

  await api.replyQuestion(PROJECT_DIRECTORY, "que_123", [
    ["Existing API"],
    ["Yes", "Add tests"],
  ]);
  await api.rejectQuestion(PROJECT_DIRECTORY, "que_123");

  assert.deepEqual(await api.listSessionTodos(
    PROJECT_DIRECTORY,
    "ses_test123",
  ), [
    {
      content: "Add tests",
      status: "in_progress",
      priority: "high",
    },
  ]);

  assert.deepEqual(calls, [
    ["list", { directory: PROJECT_DIRECTORY }],
    [
      "reply",
      {
        requestID: "que_123",
        directory: PROJECT_DIRECTORY,
        answers: [["Existing API"], ["Yes", "Add tests"]],
      },
    ],
    [
      "reject",
      {
        requestID: "que_123",
        directory: PROJECT_DIRECTORY,
      },
    ],
    [
      "todo",
      {
        sessionID: "ses_test123",
        directory: PROJECT_DIRECTORY,
      },
    ],
  ]);

  await assert.rejects(
    api.replyQuestion(PROJECT_DIRECTORY, "que_123", []),
    /question answers are invalid/,
  );
  await assert.rejects(
    api.rejectQuestion(PROJECT_DIRECTORY, "bad id"),
    /question request identifier is invalid/,
  );
});

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

  const session = await api.createProjectSession(PROJECT_DIRECTORY, {
    title: "  Mobile session  ",
    model: { providerID: "provider", modelID: "model", variant: "high" },
  });

  assert.equal(session.id, "ses_test123");
  assert.deepEqual(calls, [
    {
      directory: PROJECT_DIRECTORY,
      title: "Mobile session",
      model: { id: "model", providerID: "provider", variant: "high" },
    },
  ]);

  await assert.rejects(
    api.createProjectSession(PROJECT_DIRECTORY, {
      title: "x",
      model: { providerID: "../bad", modelID: "model" },
    }),
    /selected model is invalid/,
  );

  await assert.rejects(
    api.createProjectSession(PROJECT_DIRECTORY, {
      title: "x",
      model: {
        providerID: "provider",
        modelID: "model",
        variant: "bad variant",
      },
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
    invalidApi.createProjectSession(PROJECT_DIRECTORY, { title: "x" }),
    /unexpected response/,
  );

  await assert.rejects(
    api.createProjectSession("/tmp/other", { title: "x" }),
    /project directory is invalid/,
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

  assert.deepEqual(
    await api.listProjectSessions(PROJECT_DIRECTORY),
    [sessions[0]],
  );
  assert.deepEqual(
    await api.listSessionMessages(PROJECT_DIRECTORY, "ses_one"),
    [messageRows[0]],
  );
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
    api.listSessionMessages(PROJECT_DIRECTORY, "../ses_bad"),
    /session identifier is invalid/,
  );
});

test("sends validated image attachments with prompts", async (t) => {
  t.after(resetProjectDirectoryScope);

  const calls = [];
  const api = createOpenCodeApi({
    session: {
      promptAsync: async (parameters) => {
        calls.push(parameters);
        return fulfilled(null, 204);
      },
    },
  });
  const url = "data:image/png;base64,iVBORw0KGgo=";

  await api.sendPromptAsync(PROJECT_DIRECTORY, "ses_test123", {
    text: "Review this screenshot.",
    attachments: [{ mime: "image/png", filename: "shot.png", url }],
  });

  assert.deepEqual(calls[0].parts, [
    { type: "text", text: "Review this screenshot." },
    {
      type: "file",
      mime: "image/png",
      filename: "shot.png",
      url,
    },
  ]);

  await assert.rejects(
    api.sendPromptAsync(PROJECT_DIRECTORY, "ses_test123", {
      text: "Review this image.",
      attachments: [{ mime: "image/svg+xml", filename: "x.svg", url }],
    }),
    /Attach up to 3 PNG/,
  );
  assert.equal(calls.length, 1);
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
      shell: async (parameters) => {
        calls.push(["shell", parameters]);
        return fulfilled({ parts: [] });
      },
      abort: async (parameters) => {
        calls.push(["abort", parameters]);
        return fulfilled(true);
      },
    },
  });

  await api.sendPromptAsync(PROJECT_DIRECTORY, "ses_test123", {
    text: "  Inspect this project.  ",
    model: { providerID: "provider", modelID: "model", variant: "low" },
    agent: "build",
  });
  await api.sendCommand(PROJECT_DIRECTORY, "ses_test123", {
    command: "init",
    arguments: "smaller",
    model: { providerID: "provider", modelID: "model", variant: "max" },
    agent: "build",
  });
  await api.runProjectShell(PROJECT_DIRECTORY, "ses_test123", {
    command: "  git status  ",
  });
  await api.abortSession(PROJECT_DIRECTORY, "ses_test123");

  assert.deepEqual(calls, [
    [
      "prompt",
      {
        sessionID: "ses_test123",
        directory: PROJECT_DIRECTORY,
        parts: [{ type: "text", text: "Inspect this project." }],
        model: { providerID: "provider", modelID: "model" },
        variant: "low",
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
        variant: "max",
        agent: "build",
      },
    ],
    [
      "shell",
      {
        sessionID: "ses_test123",
        directory: PROJECT_DIRECTORY,
        command: "git status",
        agent: "build",
      },
    ],
    ["abort", { sessionID: "ses_test123", directory: PROJECT_DIRECTORY }],
  ]);

  await assert.rejects(
    api.sendPromptAsync(PROJECT_DIRECTORY, "ses_test123", { text: "   " }),
    /Enter a prompt/,
  );
  await assert.rejects(
    api.sendCommand(PROJECT_DIRECTORY, "ses_test123", {
      command: "bad command",
    }),
    /selected command is invalid/,
  );
  await assert.rejects(
    api.runProjectShell(PROJECT_DIRECTORY, "ses_test123", {
      command: "",
    }),
    /valid shell command/,
  );
});

test("creates, resizes, and closes project terminals", async (t) => {
  t.after(resetProjectDirectoryScope);

  const calls = [];
  const terminal = {
    id: "pty_abc123XYZ",
    title: "Shell",
    command: "/bin/sh",
    args: ["-l"],
    cwd: PROJECT_DIRECTORY,
    status: "running",
    pid: 4321,
  };
  const api = createOpenCodeApi({
    pty: {
      create: async (parameters) => {
        calls.push(["create", parameters]);
        return fulfilled(terminal);
      },
      update: async (parameters) => {
        calls.push(["update", parameters]);
        return fulfilled(terminal);
      },
      remove: async (parameters) => {
        calls.push(["remove", parameters]);
        return fulfilled(true);
      },
    },
  });

  assert.deepEqual(
    await api.createProjectTerminal(PROJECT_DIRECTORY, {
      title: "  Shell  ",
    }),
    terminal,
  );
  assert.deepEqual(
    await api.createProjectTerminal(PROJECT_DIRECTORY, {
      title: "Alpine",
      command: "/data/app/libproot.so",
      args: ["--link2symlink", "-0", "/bin/ash"],
      cwd: PROJECT_DIRECTORY,
      env: { HOME: "/root", PATH: "/bin:/usr/bin" },
    }),
    terminal,
  );
  await api.resizeProjectTerminal(PROJECT_DIRECTORY, terminal.id, {
    cols: 90,
    rows: 30,
  });
  assert.equal(
    await api.removeProjectTerminal(PROJECT_DIRECTORY, terminal.id),
    true,
  );

  assert.deepEqual(calls, [
    [
      "create",
      { directory: PROJECT_DIRECTORY, title: "Shell" },
    ],
    [
      "create",
      {
        directory: PROJECT_DIRECTORY,
        title: "Alpine",
        command: "/data/app/libproot.so",
        args: ["--link2symlink", "-0", "/bin/ash"],
        cwd: PROJECT_DIRECTORY,
        env: { HOME: "/root", PATH: "/bin:/usr/bin" },
      },
    ],
    [
      "update",
      {
        ptyID: terminal.id,
        directory: PROJECT_DIRECTORY,
        size: { cols: 90, rows: 30 },
      },
    ],
    [
      "remove",
      { ptyID: terminal.id, directory: PROJECT_DIRECTORY },
    ],
  ]);

  await assert.rejects(
    api.resizeProjectTerminal(PROJECT_DIRECTORY, "pty_bad-id", {
      cols: 90,
      rows: 30,
    }),
    /terminal identifier/,
  );
  await assert.rejects(
    api.resizeProjectTerminal(PROJECT_DIRECTORY, terminal.id, {
      cols: 2,
      rows: 30,
    }),
    /terminal size/,
  );
});

test("reverts a message and restores reverted messages", async (t) => {
  t.after(resetProjectDirectoryScope);

  const calls = [];
  const session = {
    id: "ses_abc123",
    directory: PROJECT_DIRECTORY,
    revert: { messageID: "msg_target123" },
  };
  const api = createOpenCodeApi({
    session: {
      revert: async (parameters) => {
        calls.push(["revert", parameters]);
        return fulfilled(session);
      },
      unrevert: async (parameters) => {
        calls.push(["unrevert", parameters]);
        return fulfilled({ ...session, revert: undefined });
      },
    },
  });

  assert.deepEqual(
    await api.revertSessionMessage(
      PROJECT_DIRECTORY,
      "ses_abc123",
      "msg_target123",
    ),
    session,
  );
  assert.equal(
    (
      await api.restoreRevertedSession(
        PROJECT_DIRECTORY,
        "ses_abc123",
      )
    ).revert,
    undefined,
  );

  assert.deepEqual(calls, [
    [
      "revert",
      {
        sessionID: "ses_abc123",
        directory: PROJECT_DIRECTORY,
        messageID: "msg_target123",
      },
    ],
    [
      "unrevert",
      {
        sessionID: "ses_abc123",
        directory: PROJECT_DIRECTORY,
      },
    ],
  ]);

  await assert.rejects(
    api.revertSessionMessage(
      PROJECT_DIRECTORY,
      "ses_abc123",
      "not-a-message",
    ),
    /message identifier/,
  );
});

test("reports a terminal that starts outside the project folder", async (t) => {
  t.after(resetProjectDirectoryScope);

  const api = createOpenCodeApi({
    pty: {
      create: async () =>
        fulfilled({
          id: "pty_abc123XYZ",
          title: "Shell",
          command: "/bin/sh",
          args: ["-l"],
          cwd: "/root",
          status: "running",
          pid: 4321,
        }),
    },
  });

  await assert.rejects(
    api.createProjectTerminal(PROJECT_DIRECTORY),
    (error) =>
      error.kind === "invalid" &&
      error.message.includes("started in /root") &&
      error.message.includes(PROJECT_DIRECTORY),
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

  assert.deepEqual(
    (await api.listProviders(PROJECT_DIRECTORY)).providers,
    [{ id: "p" }],
  );
  assert.deepEqual(
    await api.listCommands(PROJECT_DIRECTORY),
    [{ name: "init" }],
  );
  assert.deepEqual(await api.getVcsStatus(PROJECT_DIRECTORY), []);
  assert.deepEqual(
    await api.getVcsDiff(PROJECT_DIRECTORY, { mode: "branch", context: 5 }),
    [],
  );

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
    api.getVcsDiff(PROJECT_DIRECTORY, { mode: "working" }),
    /diff mode is invalid/,
  );
  await assert.rejects(
    api.getVcsDiff(PROJECT_DIRECTORY, { mode: "git", context: 99 }),
    /diff context is invalid/,
  );
});

test("lists the server agents that back build and plan modes", async () => {
  const calls = [];
  const api = createOpenCodeApi({
    app: {
      agents: async (parameters) => {
        calls.push(["agents", parameters]);
        return fulfilled([
          {
            name: "build",
            description: "The default agent.",
            mode: "primary",
          },
          { name: "plan", description: "Plan mode.", mode: "primary" },
          { name: "explore", description: "", mode: "subagent" },
          { name: "custom agent", description: "", mode: "primary" },
          { description: "missing a name", mode: "primary" },
          "not an agent",
        ]);
      },
    },
  });

  const agents = await api.listAgents(PROJECT_DIRECTORY);

  assert.deepEqual(calls, [["agents", { directory: PROJECT_DIRECTORY }]]);
  assert.deepEqual(
    agents.map((agent) => agent.name),
    ["build", "plan", "explore"],
  );
  assert.equal(agents[0].mode, "primary");
  assert.equal(agents[0].hidden, false);
  assert.equal(agents[1].description, "Plan mode.");
});

test("loads connected providers and starts GitHub Copilot sign-in", async () => {
  const calls = [];
  const api = createOpenCodeApi({
    provider: {
      list: async (parameters) => {
        calls.push(["providers", parameters]);
        return fulfilled({
          all: [],
          default: {},
          connected: ["github-copilot", "opencode", "github-copilot", 7],
        });
      },
      oauth: {
        authorize: async (parameters) => {
          calls.push(["authorize", parameters]);
          return fulfilled({
            url: "https://github.com/login/device",
            method: "auto",
            instructions: "Enter code: ABCD-1234",
          });
        },
        callback: async (parameters) => {
          calls.push(["callback", parameters]);
          return fulfilled(true);
        },
      },
    },
  });

  assert.deepEqual(
    await api.listConnectedProviders(PROJECT_DIRECTORY),
    ["github-copilot", "opencode"],
  );
  assert.deepEqual(
    await api.authorizeGitHubCopilot(PROJECT_DIRECTORY),
    {
      url: "https://github.com/login/device",
      instructions: "Enter code: ABCD-1234",
      method: "auto",
    },
  );
  assert.equal(
    await api.completeGitHubCopilot(PROJECT_DIRECTORY),
    true,
  );
  assert.deepEqual(calls, [
    ["providers", { directory: PROJECT_DIRECTORY }],
    [
      "authorize",
      {
        providerID: "github-copilot",
        directory: PROJECT_DIRECTORY,
        method: 0,
        inputs: { deploymentType: "github.com" },
      },
    ],
    [
      "callback",
      {
        providerID: "github-copilot",
        directory: PROJECT_DIRECTORY,
        method: 0,
      },
    ],
  ]);
});

test("loads project files, searches, and applies safe patches", async () => {
  const calls = [];
  const patch = [
    "diff --git a/src/App.jsx b/src/App.jsx",
    "--- a/src/App.jsx",
    "+++ b/src/App.jsx",
    "@@ -1,1 +1,1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");
  const api = createOpenCodeApi({
    file: {
      list: async (parameters) => {
        calls.push(["list", parameters]);
        return fulfilled([
          {
            name: "src",
            path: "src/",
            absolute: `${PROJECT_DIRECTORY}/src`,
            type: "directory",
            ignored: false,
          },
          {
            name: "README.md",
            path: "README.md",
            absolute: `${PROJECT_DIRECTORY}/README.md`,
            type: "file",
            ignored: false,
          },
        ]);
      },
      read: async (parameters) => {
        calls.push(["read", parameters]);
        return fulfilled({
          type: "text",
          content: "hello",
          mimeType: "text/plain",
        });
      },
    },
    find: {
      files: async (parameters) => {
        calls.push(["find", parameters]);
        return fulfilled(["src/App.jsx", "src/App.jsx", "../secret"]);
      },
    },
    vcs: {
      apply: async (parameters) => {
        calls.push(["apply", parameters]);
        return fulfilled({ applied: true });
      },
    },
  });

  assert.deepEqual(await api.listProjectFiles(PROJECT_DIRECTORY, "."), [
    { name: "src", path: "src", type: "directory", ignored: false },
    { name: "README.md", path: "README.md", type: "file", ignored: false },
  ]);
  assert.deepEqual(
    await api.readProjectFile(PROJECT_DIRECTORY, "README.md"),
    {
      type: "text",
      content: "hello",
      encoding: null,
      mimeType: "text/plain",
    },
  );
  assert.deepEqual(
    await api.searchProjectFiles(PROJECT_DIRECTORY, " App "),
    ["src/App.jsx"],
  );
  assert.deepEqual(
    await api.applyProjectPatch(PROJECT_DIRECTORY, patch),
    { applied: true },
  );

  assert.deepEqual(calls, [
    ["list", { directory: PROJECT_DIRECTORY, path: "." }],
    ["read", { directory: PROJECT_DIRECTORY, path: "README.md" }],
    [
      "find",
      {
        directory: PROJECT_DIRECTORY,
        query: "App",
        type: "file",
        limit: 100,
      },
    ],
    ["apply", { directory: PROJECT_DIRECTORY, patch }],
  ]);

  await assert.rejects(
    api.listProjectFiles(PROJECT_DIRECTORY, "../secret"),
    /file path is invalid/,
  );
  await assert.rejects(
    api.searchProjectFiles(PROJECT_DIRECTORY, " "),
    /Enter text/,
  );
  await assert.rejects(
    api.applyProjectPatch(PROJECT_DIRECTORY, "not a patch"),
    /not a safe single-file patch/,
  );
});

test("accepts an absolute guest shell command with bounded arguments", () => {
  const request = normalizeShellRequest({
    command: "/data/app/libproot.so",
    args: ["--link2symlink", "-0", "-r", "/rootfs/", "/bin/ash", "-l"],
    cwd: "/data/user/0/com.opencode.mobile/files/workspace",
    env: { HOME: "/root", PATH: "/usr/bin:/bin" },
  });

  assert.equal(request.command, "/data/app/libproot.so");
  assert.equal(request.args.length, 6);
  assert.equal(
    request.cwd,
    "/data/user/0/com.opencode.mobile/files/workspace",
  );
  assert.deepEqual(request.env, { HOME: "/root", PATH: "/usr/bin:/bin" });
});

test("refuses a shell command that is not an absolute path", () => {
  assert.equal(normalizeShellRequest({ command: "sh" }), null);
  assert.equal(normalizeShellRequest({ command: "  " }), null);
  assert.equal(normalizeShellRequest({}), null);
  assert.equal(
    normalizeShellRequest({ command: "proot\u0000 --rootfs" }),
    null,
  );
});

test("drops unsafe arguments, paths, and environment entries", () => {
  const request = normalizeShellRequest({
    command: "/data/app/libproot.so",
    args: ["ok", "bad\u0000arg", 42, null, "x".repeat(9000)],
    cwd: "relative/path",
    env: {
      GOOD: "value",
      "bad key": "value",
      "1INVALID": "value",
      LONG: "x".repeat(9000),
    },
  });

  assert.deepEqual(request.args, ["ok"]);
  assert.equal(request.cwd, undefined);
  assert.deepEqual(request.env, { GOOD: "value" });
});

test("caps the number of arguments and environment keys", () => {
  const args = Array.from({ length: 200 }, (_, index) => `arg-${index}`);
  const env = Object.fromEntries(
    Array.from({ length: 100 }, (_, index) => [`KEY_${index}`, "v"]),
  );

  const request = normalizeShellRequest({
    command: "/data/app/libproot.so",
    args,
    env,
  });

  assert.equal(request.args.length, 64);
  assert.equal(Object.keys(request.env).length, 32);
});
