import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import { nativeFetch } from "./nativeFetch.js";
import { PROJECT_DIRECTORY } from "./project.js";
import {
  BROWSER_REQUEST_TIMEOUT_MS,
  CONNECTION_ERROR_KINDS,
  DEFAULT_OPENCODE_URL,
  OpenCodeConnectionError,
  runWithTimeout,
  validateOpenCodeBaseUrl,
} from "./connection.js";

export { PROJECT_DIRECTORY };

const SESSION_ID_PATTERN = /^ses_[A-Za-z0-9]+$/;
const MODEL_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const AGENT_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const COMMAND_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAX_PROMPT_CHARS = 32000;
const MESSAGE_PAGE_LIMIT = 200;

const configuredBaseUrl = import.meta.env?.VITE_OPENCODE_URL;
export const OPENCODE_BASE_URL = (
  typeof configuredBaseUrl === "string" && configuredBaseUrl.trim()
    ? configuredBaseUrl.trim()
    : DEFAULT_OPENCODE_URL
).replace(/\/+$/, "");

export const OPENCODE_CONFIGURATION_ERROR = validateOpenCodeBaseUrl(
  OPENCODE_BASE_URL,
  { native: Boolean(nativeFetch) },
);

export const MAX_COMPOSER_CHARS = MAX_PROMPT_CHARS;

export const opencode = createOpencodeClient({
  baseUrl: OPENCODE_BASE_URL,
  ...(nativeFetch ? { fetch: nativeFetch } : {}),
});

function unexpectedResponse(cause) {
  return new OpenCodeConnectionError(
    CONNECTION_ERROR_KINDS.INVALID,
    "The OpenCode server returned an unexpected response.",
    { cause },
  );
}

function invalidInput(message) {
  return new OpenCodeConnectionError(
    CONNECTION_ERROR_KINDS.INVALID,
    message,
  );
}

function httpFailure(status) {
  return new OpenCodeConnectionError(
    CONNECTION_ERROR_KINDS.HTTP,
    `The OpenCode server returned HTTP ${status}.`,
    { status },
  );
}

function isHttpStatus(status) {
  return Number.isInteger(status) && (status < 200 || status >= 300);
}

function ensureConfigured() {
  if (OPENCODE_CONFIGURATION_ERROR) {
    throw new OpenCodeConnectionError(
      CONNECTION_ERROR_KINDS.CONFIGURATION,
      OPENCODE_CONFIGURATION_ERROR,
    );
  }
}

function normalizeRequestFailure(error) {
  if (error instanceof OpenCodeConnectionError) return error;

  if (error?.name === "AbortError") {
    return new OpenCodeConnectionError(
      CONNECTION_ERROR_KINDS.ABORTED,
      "The OpenCode request was cancelled.",
      { cause: error },
    );
  }

  return unexpectedResponse(error);
}

async function executeRequest(task, signal) {
  if (nativeFetch) return task(signal);

  return runWithTimeout(task, {
    signal,
    timeoutMs: BROWSER_REQUEST_TIMEOUT_MS,
  });
}

function validateSessionId(sessionID) {
  if (
    typeof sessionID !== "string" ||
    !SESSION_ID_PATTERN.test(sessionID)
  ) {
    throw invalidInput("The session identifier is invalid.");
  }

  return sessionID;
}

function validateModel(model) {
  if (model == null) return undefined;

  if (
    typeof model !== "object" ||
    typeof model.providerID !== "string" ||
    typeof model.modelID !== "string" ||
    !MODEL_ID_PATTERN.test(model.providerID) ||
    !MODEL_ID_PATTERN.test(model.modelID)
  ) {
    throw invalidInput("The selected model is invalid.");
  }

  return {
    providerID: model.providerID,
    modelID: model.modelID,
  };
}

function validateAgent(agent) {
  if (agent == null) return undefined;

  if (
    typeof agent !== "string" ||
    !AGENT_ID_PATTERN.test(agent)
  ) {
    throw invalidInput("The selected agent is invalid.");
  }

  return agent;
}

function validatePromptText(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw invalidInput("Enter a prompt before sending.");
  }

  const trimmed = text.trim();

  if (trimmed.length > MAX_PROMPT_CHARS) {
    throw invalidInput(
      `Prompts are limited to ${MAX_PROMPT_CHARS.toLocaleString()} characters.`,
    );
  }

  return trimmed;
}

function validateCommand(command) {
  if (
    typeof command !== "string" ||
    !COMMAND_NAME_PATTERN.test(command)
  ) {
    throw invalidInput("The selected command is invalid.");
  }

  return command;
}

function validateCommandArguments(args) {
  if (args == null) return "";
  if (typeof args !== "string") {
    throw invalidInput("The command arguments are invalid.");
  }

  if (args.length > MAX_PROMPT_CHARS) {
    throw invalidInput(
      `Command arguments are limited to ${MAX_PROMPT_CHARS.toLocaleString()} characters.`,
    );
  }

  return args;
}

export function unwrapOpenCodeResult(result, fallback) {
  const status = result?.response?.status;

  if (result?.error) {
    if (result.error instanceof OpenCodeConnectionError) {
      throw result.error;
    }

    if (isHttpStatus(status)) {
      throw httpFailure(status);
    }

    throw new OpenCodeConnectionError(
      CONNECTION_ERROR_KINDS.NETWORK,
      fallback,
      { cause: result.error },
    );
  }

  if (isHttpStatus(status)) {
    throw httpFailure(status);
  }

  return result?.data;
}

export function validateHealthPayload(data) {
  if (
    !data ||
    typeof data !== "object" ||
    typeof data.healthy !== "boolean"
  ) {
    throw unexpectedResponse();
  }

  if (!data.healthy) {
    throw new OpenCodeConnectionError(
      CONNECTION_ERROR_KINDS.UNHEALTHY,
      "The OpenCode server reported an unhealthy state.",
    );
  }

  return data;
}

async function runRequest(client, task, fallback, signal) {
  ensureConfigured();

  let result;
  try {
    result = await executeRequest(
      (requestSignal) => task(client, requestSignal),
      signal,
    );
  } catch (error) {
    throw normalizeRequestFailure(error);
  }

  return unwrapOpenCodeResult(result, fallback);
}

function requireArray(data) {
  if (!Array.isArray(data)) throw unexpectedResponse();
  return data;
}

export function createOpenCodeApi(client = opencode) {
  return {
    checkConnection(signal) {
      return runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.global.health({ signal: requestSignal }),
        "The OpenCode server could not be reached.",
        signal,
      ).then(validateHealthPayload);
    },

    async listProjectSessions(signal) {
      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.session.list(
            { directory: PROJECT_DIRECTORY },
            { signal: requestSignal },
          ),
        "Sessions could not be loaded.",
        signal,
      );

      return requireArray(data).filter(
        (session) => session?.directory === PROJECT_DIRECTORY,
      );
    },

    async createProjectSession({ title, model } = {}, signal) {
      const normalizedModel = validateModel(model);
      const body = {
        directory: PROJECT_DIRECTORY,
        title:
          typeof title === "string" && title.trim()
            ? title.trim().slice(0, 120)
            : "New mobile session",
      };

      if (normalizedModel) {
        body.model = {
          id: normalizedModel.modelID,
          providerID: normalizedModel.providerID,
        };
      }

      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.session.create(body, { signal: requestSignal }),
        "The session could not be created.",
        signal,
      );

      if (
        !data ||
        typeof data !== "object" ||
        typeof data.id !== "string" ||
        data.directory !== PROJECT_DIRECTORY
      ) {
        throw unexpectedResponse();
      }

      return data;
    },

    async listSessionMessages(sessionID, signal) {
      const id = validateSessionId(sessionID);
      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.session.messages(
            {
              sessionID: id,
              directory: PROJECT_DIRECTORY,
              limit: MESSAGE_PAGE_LIMIT,
            },
            { signal: requestSignal },
          ),
        "Messages could not be loaded.",
        signal,
      );

      return requireArray(data).filter(
        (row) =>
          row?.info?.sessionID === id && Array.isArray(row.parts),
      );
    },

    async getSessionStatuses(signal) {
      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.session.status(
            { directory: PROJECT_DIRECTORY },
            { signal: requestSignal },
          ),
        "Session status could not be loaded.",
        signal,
      );

      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw unexpectedResponse();
      }

      return data;
    },

    async sendPromptAsync(
      sessionID,
      { text, model, agent } = {},
      signal,
    ) {
      const id = validateSessionId(sessionID);
      const normalizedModel = validateModel(model);
      const normalizedAgent = validateAgent(agent);
      const prompt = validatePromptText(text);

      const body = {
        parts: [{ type: "text", text: prompt }],
      };

      if (normalizedModel) {
        body.model = normalizedModel;
      }

      if (normalizedAgent) {
        body.agent = normalizedAgent;
      }

      return runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.session.promptAsync(
            {
              sessionID: id,
              directory: PROJECT_DIRECTORY,
              ...body,
            },
            { signal: requestSignal },
          ),
        "The prompt could not be sent.",
        signal,
      );
    },

    async sendCommand(
      sessionID,
      { command, arguments: args, model, agent } = {},
      signal,
    ) {
      const id = validateSessionId(sessionID);
      const name = validateCommand(command);
      const normalizedArguments = validateCommandArguments(args);
      const normalizedAgent = validateAgent(agent);

      const body = {
        command: name,
        arguments: normalizedArguments,
      };

      if (model?.providerID && model?.modelID) {
        body.model = `${model.providerID}/${model.modelID}`;
      }

      if (normalizedAgent) {
        body.agent = normalizedAgent;
      }

      return runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.session.command(
            {
              sessionID: id,
              directory: PROJECT_DIRECTORY,
              ...body,
            },
            { signal: requestSignal },
          ),
        "The command could not be sent.",
        signal,
      );
    },

    async abortSession(sessionID, signal) {
      const id = validateSessionId(sessionID);

      return runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.session.abort(
            { sessionID: id, directory: PROJECT_DIRECTORY },
            { signal: requestSignal },
          ),
        "The agent could not be stopped.",
        signal,
      );
    },

    async listProviders(signal) {
      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.config.providers(
            { directory: PROJECT_DIRECTORY },
            { signal: requestSignal },
          ),
        "Models could not be loaded.",
        signal,
      );

      if (
        !data ||
        typeof data !== "object" ||
        !Array.isArray(data.providers) ||
        !data.default ||
        typeof data.default !== "object"
      ) {
        throw unexpectedResponse();
      }

      return data;
    },

    async listCommands(signal) {
      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.command.list(
            { directory: PROJECT_DIRECTORY },
            { signal: requestSignal },
          ),
        "Commands could not be loaded.",
        signal,
      );

      return requireArray(data);
    },

    async getVcsStatus(signal) {
      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.vcs.status(
            { directory: PROJECT_DIRECTORY },
            { signal: requestSignal },
          ),
        "Changes could not be loaded.",
        signal,
      );

      return requireArray(data);
    },

    async getVcsDiff({ mode = "git", context = 3 } = {}, signal) {
      if (!["git", "branch"].includes(mode)) {
        throw invalidInput("The requested diff mode is invalid.");
      }

      if (
        !Number.isInteger(context) ||
        context < 0 ||
        context > 20
      ) {
        throw invalidInput("The requested diff context is invalid.");
      }

      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.vcs.diff(
            {
              directory: PROJECT_DIRECTORY,
              mode,
              context,
            },
            { signal: requestSignal },
          ),
        "Changes could not be loaded.",
        signal,
      );

      return requireArray(data);
    },
  };
}

export const opencodeApi = createOpenCodeApi();

export const checkConnection = (signal) =>
  opencodeApi.checkConnection(signal);

export const listProjectSessions = (signal) =>
  opencodeApi.listProjectSessions(signal);

export const createProjectSession = (options, signal) =>
  opencodeApi.createProjectSession(options, signal);

export const listSessionMessages = (sessionID, signal) =>
  opencodeApi.listSessionMessages(sessionID, signal);

export const getSessionStatuses = (signal) =>
  opencodeApi.getSessionStatuses(signal);

export const sendPromptAsync = (sessionID, options, signal) =>
  opencodeApi.sendPromptAsync(sessionID, options, signal);

export const sendCommand = (sessionID, options, signal) =>
  opencodeApi.sendCommand(sessionID, options, signal);

export const abortSession = (sessionID, signal) =>
  opencodeApi.abortSession(sessionID, signal);

export const listProviders = (signal) =>
  opencodeApi.listProviders(signal);

export const listCommands = (signal) =>
  opencodeApi.listCommands(signal);

export const getVcsStatus = (signal) =>
  opencodeApi.getVcsStatus(signal);

export const getVcsDiff = (options, signal) =>
  opencodeApi.getVcsDiff(options, signal);
