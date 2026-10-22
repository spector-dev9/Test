import {
  MAX_PROMPT_ATTACHMENTS,
  normalizeImageAttachment,
} from "./attachments.js";

const relativeTime = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});
const calendarDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
const sessionTitleDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const VARIANT_ORDER = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const ASSISTANT_ERROR_MESSAGES = {
  ProviderAuthError: "The model provider rejected authentication.",
  MessageOutputLengthError: "The model stopped because the output limit was reached.",
  MessageAbortedError: "The response was stopped.",
  StructuredOutputError: "The model could not produce the requested structured output.",
  ContextOverflowError: "The conversation exceeded the model context window.",
  ContentFilterError: "The model blocked this response.",
  APIError: "The model provider returned an error.",
  UnknownError: "The assistant stopped before responding.",
};

export function describeServer(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return `${url.hostname}${url.port ? `:${url.port}` : ""}`;
  } catch {
    return baseUrl;
  }
}

export function offlineTitle(kind) {
  switch (kind) {
    case "network":
      return "Cannot reach the OpenCode server";
    case "timeout":
      return "OpenCode did not respond";
    case "http":
      return "OpenCode returned an error";
    case "unhealthy":
      return "OpenCode reports an unhealthy state";
    case "configuration":
      return "OpenCode connection needs configuration";
    case "invalid":
      return "OpenCode returned an unexpected response";
    default:
      return "OpenCode is unavailable";
  }
}

export function offlineLabel(kind) {
  switch (kind) {
    case "network":
      return "Offline";
    case "timeout":
      return "Timed out";
    case "unhealthy":
      return "Unhealthy";
    case "configuration":
      return "Config error";
    case "http":
    case "invalid":
      return "Error";
    default:
      return "Unavailable";
  }
}

export function offlineHelp(kind) {
  switch (kind) {
    case "network":
      return "The app could not reach the local server. Start it and retry.";
    case "timeout":
      return "The server did not answer in time. Check that it is running, then retry.";
    case "http":
      return "The server responded, but the request failed. Check the server, then retry.";
    case "unhealthy":
      return "The server is reachable but reports an unhealthy state. Check the server, then retry.";
    case "configuration":
      return "This build's API URL conflicts with the native transport. Rebuild with the default loopback URL.";
    case "invalid":
      return "The server responded unexpectedly. Check its version, then retry.";
    default:
      return "Check the local OpenCode server and retry.";
  }
}

export function formatSessionTime(timestamp) {
  if (!Number.isFinite(timestamp)) return "Unknown time";

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Unknown time";

  const difference = timestamp - Date.now();
  const minutes = Math.round(difference / 60000);

  if (Math.abs(minutes) < 60) {
    return relativeTime.format(minutes, "minute");
  }

  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return relativeTime.format(hours, "hour");
  }

  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) {
    return relativeTime.format(days, "day");
  }

  return calendarDate.format(date);
}

export function buildSessionTitle(date = new Date()) {
  return `New session · ${sessionTitleDate.format(date)}`.slice(0, 120);
}

export function isSessionArchived(session) {
  return Number.isFinite(session?.time?.archived) &&
    session.time.archived > 0;
}

export function filterSessions(sessions, query) {
  if (!Array.isArray(sessions)) return [];
  const normalized = typeof query === "string"
    ? query.trim().toLowerCase()
    : "";

  if (!normalized) return sessions;

  return sessions.filter((session) => {
    const values = [
      session?.title,
      session?.agent,
      session?.model?.id,
      session?.model?.providerID,
    ];

    return values.some(
      (value) =>
        typeof value === "string" &&
        value.toLowerCase().includes(normalized),
    );
  });
}

export function assistantErrorMessage(error) {
  if (!error || typeof error !== "object") return null;
  return (
    ASSISTANT_ERROR_MESSAGES[error.name] ??
    ASSISTANT_ERROR_MESSAGES.UnknownError
  );
}

export const MAX_TOOL_INPUT_CHARS = 4000;
export const MAX_TOOL_OUTPUT_CHARS = 6000;
export const MAX_TOOL_SUMMARY_CHARS = 160;

const TOOL_DETAIL_KEYS = [
  "filePath",
  "path",
  "file",
  "command",
  "pattern",
  "url",
];

function truncate(value, limit) {
  if (typeof value !== "string") return "";
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n… truncated (${value.length - limit} more characters)`;
}

function toolSummary(input) {
  if (!input || typeof input !== "object") return "";

  for (const key of TOOL_DETAIL_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, MAX_TOOL_SUMMARY_CHARS);
    }
  }

  if (typeof input.title === "string" && input.title.trim()) {
    return input.title.trim().slice(0, MAX_TOOL_SUMMARY_CHARS);
  }

  return "";
}

function toolInputText(input) {
  if (!input || typeof input !== "object") return "";

  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return "";
  }
}

export function normalizeToolPart(part) {
  const state =
    part?.state && typeof part.state === "object" ? part.state : {};
  const input =
    state.input && typeof state.input === "object" ? state.input : null;
  const summary = toolSummary(input);
  const output =
    typeof state.output === "string" ? state.output : "";
  const error = typeof state.error === "string" ? state.error : "";

  const inputText = toolInputText(input);

  return {
    id: part?.id,
    name:
      typeof part?.tool === "string" && part.tool ? part.tool : "tool",
    status: typeof state.status === "string" ? state.status : "unknown",
    title:
      typeof state.title === "string" && state.title.trim()
        ? state.title.trim().slice(0, 200)
        : "",
    detail: summary.slice(0, 300),
    summary,
    input: truncate(inputText, MAX_TOOL_INPUT_CHARS),
    inputFull: inputText,
    output: truncate(output, MAX_TOOL_OUTPUT_CHARS),
    outputFull: output,
    error: truncate(error, 2000),
    errorFull: error,
  };
}

export function normalizeConversation(rows) {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row, index) => {
    const info = row?.info;
    const parts = Array.isArray(row?.parts) ? row.parts : [];

    if (!info || (info.role !== "user" && info.role !== "assistant")) {
      return [];
    }

    const text = parts
      .filter(
        (part) =>
          part?.type === "text" &&
          typeof part.text === "string" &&
          !part.ignored,
      )
      .map((part) => part.text)
      .filter(Boolean)
      .join("\n\n");

    const attachments = parts
      .filter((part) => part?.type === "file")
      .map((part) =>
        normalizeImageAttachment({
          type: part.type,
          mime: part.mime,
          filename: part.filename,
          url: part.url,
        }),
      )
      .filter(Boolean)
      .slice(0, MAX_PROMPT_ATTACHMENTS);

    const tools = parts
      .filter((part) => part?.type === "tool")
      .map((part) => normalizeToolPart(part));

    const error =
      info.role === "assistant"
        ? assistantErrorMessage(info.error)
        : null;

    if (!text && tools.length === 0 && attachments.length === 0 && !error) {
      return [];
    }

    const created = Number(info.time?.created);

    return [
      {
        id:
          typeof info.id === "string"
            ? info.id
            : `message-${index}`,
        role: info.role,
        text,
        tools,
        ...(attachments.length > 0 ? { attachments } : {}),
        error,
        created: Number.isFinite(created) ? created : null,
        completed: Boolean(info.time?.completed),
        model:
          info.role === "assistant"
            ? info.modelID ?? null
            : info.model?.modelID ?? null,
      },
    ];
  });
}

export function conversationBeforeRevert(rows, messageID) {
  if (!Array.isArray(rows) || !messageID) return Array.isArray(rows) ? rows : [];
  const index = rows.findIndex((row) => row?.info?.id === messageID);
  return index < 0 ? rows : rows.slice(0, index);
}

export function isMessageIdentifier(value) {
  return typeof value === "string" && /^msg_[A-Za-z0-9]+$/.test(value);
}

export function isConversationSettled(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return false;

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const info = rows[index]?.info;
    if (info?.role !== "assistant") continue;
    return Boolean(info.time?.completed || info.error);
  }

  return false;
}

function normalizeModelVariants(variants) {
  if (!variants || typeof variants !== "object" || Array.isArray(variants)) {
    return [];
  }

  return Object.keys(variants)
    .filter((name) => typeof name === "string" && name.trim())
    .sort((left, right) => {
      const leftIndex = VARIANT_ORDER.indexOf(left);
      const rightIndex = VARIANT_ORDER.indexOf(right);

      if (leftIndex !== -1 && rightIndex !== -1) {
        return leftIndex - rightIndex;
      }

      if (leftIndex !== -1) return -1;
      if (rightIndex !== -1) return 1;
      return left.localeCompare(right);
    });
}

export function formatVariantLabel(variant) {
  if (typeof variant !== "string" || !variant) return "Default";

  const known = {
    none: "None",
    minimal: "Minimal",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "XHigh",
    max: "Max",
  };

  if (known[variant]) return known[variant];

  return variant
    .replace(/[-_]+/g, " ")
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export function normalizeProviders(data) {
  const providers = Array.isArray(data?.providers)
    ? data.providers
        .filter(
          (provider) =>
            provider &&
            typeof provider.id === "string" &&
            typeof provider.name === "string",
        )
        .map((provider) => ({
          id: provider.id,
          name: provider.name,
          models: Object.values(provider.models ?? {})
            .filter(
              (model) =>
                model &&
                typeof model.id === "string" &&
                typeof model.name === "string",
            )
            .sort((left, right) =>
              left.name.localeCompare(right.name),
            )
            .map((model) => ({
              ...model,
              variants: normalizeModelVariants(model.variants),
            })),
        }))
        .filter((provider) => provider.models.length > 0)
    : [];

  return {
    providers,
    default:
      data?.default && typeof data.default === "object"
        ? data.default
        : {},
  };
}

function findProviderModel(providers, selection) {
  if (!selection) return null;

  const provider = providers.find(
    (item) => item.id === selection.providerID,
  );
  if (!provider) return null;

  return (
    provider.models.find((item) => item.id === selection.modelID) ?? null
  );
}

function sanitizeModelSelection(providers, selection) {
  if (!selection) return null;

  const model = findProviderModel(providers, selection);
  if (!model) return null;

  const variant =
    typeof selection.variant === "string" &&
    model.variants.includes(selection.variant)
      ? selection.variant
      : null;

  return {
    providerID: selection.providerID,
    modelID: selection.modelID,
    ...(variant ? { variant } : {}),
  };
}

export function isModelSelectionValid(providersData, selection) {
  if (!selection) return false;

  const model = findProviderModel(
    normalizeProviders(providersData).providers,
    selection,
  );

  if (!model) return false;
  if (!selection.variant) return true;
  return model.variants.includes(selection.variant);
}

export function resolveEffectiveModel({
  preferred,
  session,
  providersData,
}) {
  const normalized = normalizeProviders(providersData);
  const sessionModel =
    session?.model?.providerID && session?.model?.id
      ? {
          providerID: session.model.providerID,
          modelID: session.model.id,
          ...(typeof session.model.variant === "string" &&
          session.model.variant
            ? { variant: session.model.variant }
            : {}),
        }
      : null;
  const defaultModel =
    Object.entries(normalized.default)
      .map(([providerID, modelID]) => ({ providerID, modelID }))
      .find((model) =>
        findProviderModel(normalized.providers, model),
      ) ?? null;
  const firstModel =
    normalized.providers[0]?.models[0] && {
      providerID: normalized.providers[0].id,
      modelID: normalized.providers[0].models[0].id,
    };

  for (const candidate of [preferred, sessionModel, defaultModel]) {
    const sanitized = sanitizeModelSelection(
      normalized.providers,
      candidate,
    );

    if (sanitized) return sanitized;

    if (normalized.providers.length === 0 && candidate) {
      return candidate;
    }
  }

  return firstModel ?? null;
}

export function findModel(providersData, selection) {
  if (!selection) return null;
  const normalized = normalizeProviders(providersData);

  for (const provider of normalized.providers) {
    if (provider.id !== selection.providerID) continue;
    const model = provider.models.find(
      (item) => item.id === selection.modelID,
    );
    if (model) return { ...model, providerID: provider.id, providerName: provider.name };
  }

  return null;
}

export function formatModelLabel(selection, providersData) {
  if (!selection) return "Default model";
  const model = findModel(providersData, selection);
  const name = model?.name ?? `${selection.providerID}/${selection.modelID}`;
  return selection.variant
    ? `${name} · ${formatVariantLabel(selection.variant)}`
    : name;
}

export function parseComposerSubmission(text, commands = []) {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) return null;

  const match = /^\/([A-Za-z0-9._-]+)(?:\s+([\s\S]*))?$/.exec(trimmed);

  if (match) {
    const name = match[1];
    if (commands.some((command) => command?.name === name)) {
      return {
        kind: "command",
        command: name,
        arguments: match[2] ?? "",
      };
    }
  }

  return { kind: "prompt", text: trimmed };
}

export function filterCommands(commands, draft) {
  if (!Array.isArray(commands) || typeof draft !== "string") return [];
  const match = /^\/([A-Za-z0-9._-]*)$/.exec(draft.trim());
  if (!match) return [];
  const query = match[1].toLowerCase();

  return commands
    .filter(
      (command) =>
        command &&
        typeof command.name === "string" &&
        command.name.toLowerCase().startsWith(query),
    )
    .slice(0, 8);
}

export function summarizeDiffs(rows) {
  if (!Array.isArray(rows)) {
    return { files: 0, additions: 0, deletions: 0 };
  }

  return rows.reduce(
    (summary, row) => ({
      files: summary.files + 1,
      additions:
        summary.additions +
        (Number.isFinite(row?.additions) ? row.additions : 0),
      deletions:
        summary.deletions +
        (Number.isFinite(row?.deletions) ? row.deletions : 0),
    }),
    { files: 0, additions: 0, deletions: 0 },
  );
}

export function patchForFile(diffs, file) {
  if (!Array.isArray(diffs)) return "";
  return (
    diffs.find((diff) => diff?.file === file)?.patch ??
    diffs.find((diff) => diff?.path === file)?.patch ??
    ""
  );
}
