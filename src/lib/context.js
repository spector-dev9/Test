import { findModel } from "./workspace.js";

function number(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function normalizeTokens(tokens) {
  if (!tokens || typeof tokens !== "object") return null;

  return {
    input: number(tokens.input),
    output: number(tokens.output),
    reasoning: number(tokens.reasoning),
    cacheRead: number(tokens.cache?.read),
    cacheWrite: number(tokens.cache?.write),
  };
}

export function tokenTotal(tokens) {
  if (!tokens) return 0;
  return (
    tokens.input +
    tokens.output +
    tokens.reasoning +
    tokens.cacheRead +
    tokens.cacheWrite
  );
}

export function promptTokenTotal(tokens) {
  if (!tokens) return 0;
  return tokens.input + tokens.cacheRead + tokens.cacheWrite;
}

export function formatTokenCount(value) {
  const amount = number(value);
  if (amount < 1000) return String(Math.round(amount));
  if (amount < 1_000_000) {
    return `${(amount / 1000).toFixed(amount < 10_000 ? 1 : 0)}k`;
  }
  return `${(amount / 1_000_000).toFixed(1)}m`;
}

export function summarizeSessionContext({
  session,
  rows,
  providersData,
  effectiveModel,
}) {
  const messages = Array.isArray(rows) ? rows : [];
  let userMessages = 0;
  let assistantMessages = 0;
  let toolCalls = 0;
  let cost = 0;
  let latestTokens = null;
  let latestModel = null;
  let latestAt = null;
  const totals = {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };

  for (const row of messages) {
    const info = row?.info;
    const parts = Array.isArray(row?.parts) ? row.parts : [];

    if (info?.role === "user") userMessages += 1;

    if (info?.role === "assistant") {
      assistantMessages += 1;
      toolCalls += parts.filter((part) => part?.type === "tool").length;

      if (Number.isFinite(info.cost)) cost += info.cost;

      const created = Number(info.time?.created);
      if (Number.isFinite(created)) {
        latestAt =
          latestAt == null || created > latestAt ? created : latestAt;
      }

      const tokens = normalizeTokens(info.tokens);
      if (tokens) {
        latestTokens = tokens;
        latestModel = {
          providerID:
            typeof info.providerID === "string" ? info.providerID : null,
          modelID: typeof info.modelID === "string" ? info.modelID : null,
        };

        totals.input += tokens.input;
        totals.output += tokens.output;
        totals.reasoning += tokens.reasoning;
        totals.cacheRead += tokens.cacheRead;
        totals.cacheWrite += tokens.cacheWrite;
      }
    }
  }

  const modelSelection =
    latestModel ??
    (effectiveModel
      ? {
          providerID: effectiveModel.providerID,
          modelID: effectiveModel.modelID,
        }
      : null);
  const model = modelSelection
    ? findModel(providersData, modelSelection)
    : null;
  const limit =
    Number.isFinite(model?.limit?.context) && model.limit.context > 0
      ? model.limit.context
      : null;
  const latestPromptTokens = promptTokenTotal(latestTokens);
  const percent =
    limit && latestTokens
      ? Math.max(0, (latestPromptTokens / limit) * 100)
      : null;

  return {
    messageCount: messages.length,
    userMessages,
    assistantMessages,
    toolCalls,
    latestAt,
    tokensReported: Boolean(latestTokens),
    latestTokens,
    latestPromptTokens,
    totals,
    totalTokens: tokenTotal(totals),
    cost: Number.isFinite(cost) ? cost : 0,
    model,
    limit,
    percent,
    sessionTitle:
      typeof session?.title === "string" && session.title.trim()
        ? session.title.trim()
        : "Untitled session",
  };
}
