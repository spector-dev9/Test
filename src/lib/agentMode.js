export const AGENT_MODES = Object.freeze(["build", "plan"]);
export const DEFAULT_AGENT_MODE = "build";
export const AGENT_MODE_STORAGE_KEY = "opencode-mobile.agent-mode";

const MODE_LABELS = {
  build: "Build",
  plan: "Plan",
};

const MODE_DESCRIPTIONS = {
  build: "Implements changes with the existing tools and permissions.",
  plan: "Inspects the project and writes a plan without changing files.",
};

function defaultStorage() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function normalizeAgentMode(value) {
  return typeof value === "string" && AGENT_MODES.includes(value)
    ? value
    : DEFAULT_AGENT_MODE;
}

export function agentModeLabel(mode) {
  return MODE_LABELS[normalizeAgentMode(mode)];
}

export function agentModeDescription(mode) {
  return MODE_DESCRIPTIONS[normalizeAgentMode(mode)];
}

export function readStoredAgentMode(storage = defaultStorage()) {
  if (!storage) return DEFAULT_AGENT_MODE;

  try {
    return normalizeAgentMode(storage.getItem(AGENT_MODE_STORAGE_KEY));
  } catch {
    return DEFAULT_AGENT_MODE;
  }
}

export function storeAgentMode(mode, storage = defaultStorage()) {
  const normalized = normalizeAgentMode(mode);

  if (storage) {
    try {
      storage.setItem(AGENT_MODE_STORAGE_KEY, normalized);
    } catch {
      // Preference persistence is best effort.
    }
  }

  return normalized;
}

function agentMatchesMode(agent, mode) {
  if (!agent || typeof agent.name !== "string") return false;
  if (agent.name.toLowerCase() !== mode) return false;
  if (agent.hidden === true) return false;
  return agent.mode === "primary" || agent.mode === "all";
}

/**
 * Resolve the agent that must be sent with a prompt for the selected mode.
 *
 * The server is the source of truth: when it exposes a "build" or "plan"
 * primary agent, that exact agent name is used so the mode changes real agent
 * behaviour. When the server does not expose one, the session agent is kept so
 * the prompt still runs with the project's configured agent.
 */
export function resolveAgentName({ mode, agents, fallback }) {
  const normalized = normalizeAgentMode(mode);
  const list = Array.isArray(agents) ? agents : [];
  const match = list.find((agent) => agentMatchesMode(agent, normalized));

  if (match) return match.name;

  if (typeof fallback === "string" && fallback.trim()) return fallback.trim();

  return null;
}

export function availableAgentModes(agents) {
  const list = Array.isArray(agents) ? agents : [];

  return AGENT_MODES.filter((mode) =>
    list.some((agent) => agentMatchesMode(agent, mode)),
  );
}
