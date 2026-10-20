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
      .map((part) => ({
        id: part.id,
        name:
          typeof part.tool === "string" && part.tool
            ? part.tool
            : "tool",
        status:
          typeof part.state?.status === "string"
            ? part.state.status
            : "unknown",
      }));

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

export function isConversationSettled(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return false;

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const info = rows[index]?.info;
    if (info?.role !== "assistant") continue;
    return Boolean(info.time?.completed || info.error);
  }

  return false;
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
            ),
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

function modelExists(providers, model) {
  if (!model) return false;

  return providers.some(
    (provider) =>
      provider.id === model.providerID &&
      provider.models.some((item) => item.id === model.modelID),
  );
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
        }
      : null;
  const defaultModel =
    Object.entries(normalized.default)
      .map(([providerID, modelID]) => ({ providerID, modelID }))
      .find((model) => modelExists(normalized.providers, model)) ??
    null;
  const firstModel =
    normalized.providers[0]?.models[0] && {
      providerID: normalized.providers[0].id,
      modelID: normalized.providers[0].models[0].id,
    };

  for (const candidate of [preferred, sessionModel, defaultModel]) {
    if (
      modelExists(normalized.providers, candidate) ||
      (normalized.providers.length === 0 && candidate)
    ) {
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
  return model?.name ?? `${selection.providerID}/${selection.modelID}`;
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
