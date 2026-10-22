import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_MODES,
  DEFAULT_AGENT_MODE,
  agentModeDescription,
  agentModeLabel,
  availableAgentModes,
  normalizeAgentMode,
  readStoredAgentMode,
  resolveAgentName,
  storeAgentMode,
} from "./agentMode.js";

const AGENTS = [
  {
    name: "build",
    description: "The default agent.",
    mode: "primary",
    hidden: false,
  },
  {
    name: "plan",
    description: "Plan mode. Disallows all edit tools.",
    mode: "primary",
    hidden: false,
  },
  { name: "explore", description: "", mode: "subagent", hidden: false },
  { name: "compaction", description: "", mode: "primary", hidden: true },
];

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("normalizes agent modes to the supported set", () => {
  assert.equal(normalizeAgentMode("build"), "build");
  assert.equal(normalizeAgentMode("plan"), "plan");
  assert.equal(normalizeAgentMode("PLAN"), DEFAULT_AGENT_MODE);
  assert.equal(normalizeAgentMode(undefined), DEFAULT_AGENT_MODE);
  assert.equal(normalizeAgentMode(42), DEFAULT_AGENT_MODE);
  assert.deepEqual([...AGENT_MODES], ["build", "plan"]);
});

test("describes each mode for the composer", () => {
  assert.equal(agentModeLabel("build"), "Build");
  assert.equal(agentModeLabel("plan"), "Plan");
  assert.match(agentModeDescription("plan"), /plan/i);
  assert.match(agentModeDescription("build"), /implement/i);
});

test("persists the selected mode on the device", () => {
  const storage = memoryStorage();

  assert.equal(readStoredAgentMode(storage), DEFAULT_AGENT_MODE);
  assert.equal(storeAgentMode("plan", storage), "plan");
  assert.equal(readStoredAgentMode(storage), "plan");
  assert.equal(storeAgentMode("nonsense", storage), DEFAULT_AGENT_MODE);
  assert.equal(readStoredAgentMode(storage), DEFAULT_AGENT_MODE);
});

test("survives broken preference storage", () => {
  const broken = {
    getItem() {
      throw new Error("unavailable");
    },
    setItem() {
      throw new Error("unavailable");
    },
  };

  assert.equal(readStoredAgentMode(broken), DEFAULT_AGENT_MODE);
  assert.equal(storeAgentMode("plan", broken), "plan");
});

test("resolves the real server agent for the selected mode", () => {
  assert.equal(
    resolveAgentName({ mode: "plan", agents: AGENTS, fallback: "build" }),
    "plan",
  );
  assert.equal(
    resolveAgentName({ mode: "build", agents: AGENTS, fallback: "plan" }),
    "build",
  );
});

test("keeps the session agent when the server has no matching agent", () => {
  assert.equal(
    resolveAgentName({ mode: "plan", agents: [], fallback: "build" }),
    "build",
  );
  assert.equal(
    resolveAgentName({ mode: "plan", agents: [], fallback: undefined }),
    null,
  );
});

test("never selects hidden or subagent-only agents", () => {
  assert.equal(
    resolveAgentName({ mode: "plan", agents: AGENTS, fallback: "build" }),
    "plan",
  );
  assert.deepEqual(availableAgentModes(AGENTS), ["build", "plan"]);
  assert.deepEqual(
    availableAgentModes([
      { name: "build", mode: "primary", hidden: false },
      { name: "plan", mode: "primary", hidden: true },
    ]),
    ["build"],
  );
  assert.deepEqual(availableAgentModes(null), []);
});
