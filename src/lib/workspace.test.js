import assert from "node:assert/strict";
import test from "node:test";
import {
  assistantErrorMessage,
  buildSessionTitle,
  filterCommands,
  findModel,
  formatModelLabel,
  formatVariantLabel,
  isConversationSettled,
  isModelSelectionValid,
  normalizeConversation,
  normalizeProviders,
  offlineHelp,
  offlineLabel,
  offlineTitle,
  parseComposerSubmission,
  patchForFile,
  resolveEffectiveModel,
  summarizeDiffs,
} from "./workspace.js";

const providersData = {
  providers: [
    {
      id: "opencode",
      name: "OpenCode",
      models: {
        "big-pickle": {
          id: "big-pickle",
          name: "Big Pickle",
          capabilities: { toolcall: true, reasoning: true },
          limit: { context: 200000 },
          variants: {
            high: { reasoningEffort: "high" },
            low: { reasoningEffort: "low" },
            max: { reasoningEffort: "max" },
          },
        },
        small: {
          id: "small",
          name: "Small Model",
          capabilities: {},
        },
      },
    },
    {
      id: "local",
      name: "Local",
      models: {
        fast: {
          id: "fast",
          name: "Fast",
          capabilities: { toolcall: true },
        },
      },
    },
  ],
  default: { opencode: "big-pickle" },
};

test("normalizes OpenCode conversation rows into safe display messages", () => {
  const rows = [
    {
      info: {
        id: "msg_user",
        role: "user",
        sessionID: "ses_one",
        time: { created: 1000 },
      },
      parts: [
        { type: "text", text: "Hello" },
        { type: "text", text: "ignored", ignored: true },
      ],
    },
    {
      info: {
        id: "msg_assistant",
        role: "assistant",
        time: { created: 2000, completed: 3000 },
        modelID: "big-pickle",
        error: { name: "MessageAbortedError" },
      },
      parts: [
        { type: "text", text: "Working" },
        {
          type: "tool",
          id: "tool_1",
          tool: "bash",
          state: { status: "completed" },
        },
        { type: "text", text: "Difference", ignored: true },
      ],
    },
    { info: { role: "system" }, parts: [] },
    { info: { role: "assistant" }, parts: [] },
    { info: null, parts: [] },
  ];

  assert.deepEqual(normalizeConversation(rows), [
    {
      id: "msg_user",
      role: "user",
      text: "Hello",
      tools: [],
      error: null,
      created: 1000,
      completed: false,
      model: null,
    },
    {
      id: "msg_assistant",
      role: "assistant",
      text: "Working",
      tools: [{ id: "tool_1", name: "bash", status: "completed" }],
      error: "The response was stopped.",
      created: 2000,
      completed: true,
      model: "big-pickle",
    },
  ]);

  assert.deepEqual(normalizeConversation(null), []);
  assert.deepEqual(normalizeConversation([{ info: { role: "assistant" } }]), []);
});

test("maps known assistant errors without exposing raw server details", () => {
  assert.equal(
    assistantErrorMessage({ name: "ProviderAuthError", data: "secret" }),
    "The model provider rejected authentication.",
  );
  assert.equal(
    assistantErrorMessage({ name: "SomethingNew", data: "secret" }),
    "The assistant stopped before responding.",
  );
  assert.equal(assistantErrorMessage(null), null);
});

test("detects settled conversations from the last assistant message", () => {
  assert.equal(isConversationSettled(null), false);
  assert.equal(isConversationSettled([]), false);
  assert.equal(
    isConversationSettled([
      {
        info: { role: "assistant", time: { completed: 10 } },
        parts: [],
      },
    ]),
    true,
  );
  assert.equal(
    isConversationSettled([
      {
        info: { role: "user", time: { completed: 10 } },
        parts: [],
      },
      {
        info: { role: "assistant", time: {} },
        parts: [],
      },
    ]),
    false,
  );
  assert.equal(
    isConversationSettled([
      {
        info: { role: "assistant", error: { name: "APIError" }, time: {} },
        parts: [],
      },
    ]),
    true,
  );
});

test("normalizes providers and resolves preferred, session, and default models", () => {
  const normalized = normalizeProviders(providersData);
  assert.deepEqual(
    normalized.providers.map((provider) => provider.id),
    ["opencode", "local"],
  );
  assert.deepEqual(
    normalized.providers[0].models.map((model) => model.id),
    ["big-pickle", "small"],
  );
  assert.deepEqual(
    normalized.providers[0].models[0].variants,
    ["low", "high", "max"],
  );

  assert.deepEqual(
    resolveEffectiveModel({
      preferred: {
        providerID: "opencode",
        modelID: "big-pickle",
        variant: "high",
      },
      session: null,
      providersData,
    }),
    {
      providerID: "opencode",
      modelID: "big-pickle",
      variant: "high",
    },
  );

  assert.deepEqual(
    resolveEffectiveModel({
      preferred: {
        providerID: "opencode",
        modelID: "big-pickle",
        variant: "missing",
      },
      session: null,
      providersData,
    }),
    { providerID: "opencode", modelID: "big-pickle" },
  );

  assert.deepEqual(
    resolveEffectiveModel({
      preferred: null,
      session: {
        model: {
          providerID: "opencode",
          id: "big-pickle",
          variant: "max",
        },
      },
      providersData,
    }),
    {
      providerID: "opencode",
      modelID: "big-pickle",
      variant: "max",
    },
  );

  assert.deepEqual(
    resolveEffectiveModel({
      preferred: { providerID: "local", modelID: "fast" },
      session: { model: { providerID: "opencode", id: "small" } },
      providersData,
    }),
    { providerID: "local", modelID: "fast" },
  );

  assert.deepEqual(
    resolveEffectiveModel({
      preferred: { providerID: "gone", modelID: "missing" },
      session: { model: { providerID: "opencode", id: "small" } },
      providersData,
    }),
    { providerID: "opencode", modelID: "small" },
  );

  assert.deepEqual(
    resolveEffectiveModel({
      preferred: null,
      session: null,
      providersData,
    }),
    { providerID: "opencode", modelID: "big-pickle" },
  );

  assert.deepEqual(
    resolveEffectiveModel({
      preferred: { providerID: "local", modelID: "fast" },
      session: null,
      providersData: null,
    }),
    { providerID: "local", modelID: "fast" },
  );

  assert.equal(resolveEffectiveModel({ providersData: null }), null);
  assert.equal(
    findModel(providersData, { providerID: "local", modelID: "fast" })
      .name,
    "Fast",
  );
  assert.equal(
    findModel(providersData, { providerID: "missing", modelID: "fast" }),
    null,
  );
  assert.equal(
    formatModelLabel(
      { providerID: "local", modelID: "fast" },
      providersData,
    ),
    "Fast",
  );
  assert.equal(
    formatModelLabel(
      { providerID: "opencode", modelID: "big-pickle", variant: "max" },
      providersData,
    ),
    "Big Pickle · Max",
  );
  assert.equal(formatModelLabel(null, providersData), "Default model");
  assert.equal(formatVariantLabel("xhigh"), "XHigh");
  assert.equal(formatVariantLabel("custom_mode"), "Custom Mode");
  assert.equal(
    isModelSelectionValid(providersData, {
      providerID: "opencode",
      modelID: "big-pickle",
      variant: "low",
    }),
    true,
  );
  assert.equal(
    isModelSelectionValid(providersData, {
      providerID: "opencode",
      modelID: "big-pickle",
      variant: "missing",
    }),
    false,
  );
});

test("filters and parses slash commands safely", () => {
  const commands = [
    { name: "init", description: "Initialize" },
    { name: "review", description: "Review" },
    { name: "test", description: "Test" },
    { bad: true },
  ];

  assert.deepEqual(filterCommands(commands, "/").map((item) => item.name), [
    "init",
    "review",
    "test",
  ]);
  assert.deepEqual(
    filterCommands(commands, "/re").map((item) => item.name),
    ["review"],
  );
  assert.deepEqual(filterCommands(commands, "/init now"), []);
  assert.deepEqual(filterCommands(null, "/"), []);

  assert.deepEqual(parseComposerSubmission("/init", commands), {
    kind: "command",
    command: "init",
    arguments: "",
  });
  assert.deepEqual(parseComposerSubmission("  /review src  ", commands), {
    kind: "command",
    command: "review",
    arguments: "src",
  });
  assert.deepEqual(parseComposerSubmission("/unknown value", commands), {
    kind: "prompt",
    text: "/unknown value",
  });
  assert.deepEqual(parseComposerSubmission("  hello  "), {
    kind: "prompt",
    text: "hello",
  });
  assert.equal(parseComposerSubmission("   "), null);
});

test("summarizes diffs and finds matching patches", () => {
  const files = [
    { file: "src/a.js", additions: 3, deletions: 1 },
    { file: "src/b.js", additions: 0, deletions: 4 },
    { file: "src/c.js" },
  ];

  assert.deepEqual(summarizeDiffs(files), {
    files: 3,
    additions: 3,
    deletions: 5,
  });
  assert.deepEqual(summarizeDiffs(null), {
    files: 0,
    additions: 0,
    deletions: 0,
  });

  const diffs = [
    { file: "src/a.js", patch: "diff a" },
    { file: "src/b.js", patch: "" },
    { path: "src/c.js", patch: "diff c" },
  ];
  assert.equal(patchForFile(diffs, "src/a.js"), "diff a");
  assert.equal(patchForFile(diffs, "src/b.js"), "");
  assert.equal(patchForFile(diffs, "src/c.js"), "diff c");
  assert.equal(patchForFile(diffs, "src/none.js"), "");
  assert.equal(patchForFile(null, "src/a.js"), "");
});

test("builds bounded session titles and offline copy", () => {
  const title = buildSessionTitle(new Date("2026-10-20T12:34:00Z"));
  assert.match(title, /^New session · /);
  assert.ok(title.length <= 120);

  assert.match(offlineTitle("network"), /Cannot reach/);
  assert.match(offlineTitle("configuration"), /configuration/);
  assert.equal(offlineLabel("invalid"), "Error");
  assert.match(offlineHelp("timeout"), /did not answer/);
  assert.match(offlineHelp("unknown"), /local OpenCode server/);
});
