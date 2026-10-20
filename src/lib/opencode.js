import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import { nativeFetch } from "./nativeFetch.js";
import {
  MAX_FILE_SEARCH_RESULTS,
  normalizeFileContent,
  normalizeFileNodes,
  normalizeProjectPath,
  validateFilePatch,
} from "./files.js";
import {
  PROJECT_DIRECTORY,
  normalizeProjectDirectory,
} from "./project.js";
import {
  isAllowedProjectDirectory,
  registerProjectDirectories,
} from "./projectScope.js";
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
const PERMISSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
const MODEL_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const AGENT_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const COMMAND_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAX_PROMPT_CHARS = 32000;
const MAX_SESSION_TITLE_CHARS = 120;
const MAX_PERMISSION_MESSAGE_CHARS = 2000;
const MESSAGE_PAGE_LIMIT = 200;
const PERMISSION_REPLIES = ["once", "always", "reject"];

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

function validateProjectDirectory(directory) {
  const normalized = normalizeProjectDirectory(directory);

  if (!normalized || !isAllowedProjectDirectory(normalized)) {
    throw invalidInput("The project directory is invalid.");
  }

  return normalized;
}

function validateFilePath(path, { allowRoot = false } = {}) {
  const normalized = normalizeProjectPath(path, { allowRoot });

  if (!normalized) {
    throw invalidInput("The project file path is invalid.");
  }

  return normalized;
}

function validateFileSearch(query) {
  if (typeof query !== "string" || !query.trim()) {
    throw invalidInput("Enter text to search for files.");
  }

  const trimmed = query.trim();
  if (trimmed.length > 200 || /[\0\r\n]/.test(trimmed)) {
    throw invalidInput("The file search query is invalid.");
  }

  return trimmed;
}

function validateSessionTitle(title) {
  if (typeof title !== "string" || !title.trim()) {
    throw invalidInput("Session titles cannot be empty.");
  }

  const trimmed = title.trim();
  if (trimmed.length > MAX_SESSION_TITLE_CHARS) {
    throw invalidInput(
      `Session titles are limited to ${MAX_SESSION_TITLE_CHARS} characters.`,
    );
  }

  return trimmed;
}

function validatePermissionId(requestID) {
  if (
    typeof requestID !== "string" ||
    !PERMISSION_ID_PATTERN.test(requestID)
  ) {
    throw invalidInput("The permission request identifier is invalid.");
  }

  return requestID;
}

function validatePermissionReply(reply, message) {
  if (!PERMISSION_REPLIES.includes(reply)) {
    throw invalidInput("The permission response is invalid.");
  }

  if (message == null) {
    return { reply };
  }

  if (
    typeof message !== "string" ||
    message.length > MAX_PERMISSION_MESSAGE_CHARS
  ) {
    throw invalidInput("The permission message is invalid.");
  }

  const trimmed = message.trim();
  return trimmed ? { reply, message: trimmed } : { reply };
}

function normalizeProject(data) {
  if (
    !data ||
    typeof data !== "object" ||
    typeof data.id !== "string" ||
    !data.id ||
    data.id.length > 200
  ) {
    throw unexpectedResponse();
  }

  const worktree = normalizeProjectDirectory(data.worktree);
  if (!worktree) throw unexpectedResponse();

  const project = { id: data.id, worktree };

  if (typeof data.name === "string" && data.name.trim()) {
    project.name = data.name.trim().slice(0, 120);
  }

  if (data.vcs === "git") {
    project.vcs = "git";
  }

  return project;
}

function normalizePermission(data) {
  if (
    !data ||
    typeof data !== "object" ||
    typeof data.id !== "string" ||
    !PERMISSION_ID_PATTERN.test(data.id) ||
    typeof data.sessionID !== "string" ||
    !SESSION_ID_PATTERN.test(data.sessionID) ||
    typeof data.permission !== "string" ||
    !data.permission.trim()
  ) {
    throw unexpectedResponse();
  }

  const patterns = Array.isArray(data.patterns)
    ? data.patterns
        .filter((pattern) => typeof pattern === "string")
        .slice(0, 20)
    : [];
  const always = Array.isArray(data.always)
    ? data.always.filter((pattern) => typeof pattern === "string").slice(0, 20)
    : [];

  return {
    id: data.id,
    sessionID: data.sessionID,
    permission: data.permission.trim().slice(0, 200),
    patterns,
    always,
  };
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

    async listProjects(signal) {
      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.project.list(
            {},
            { signal: requestSignal },
          ),
        "Projects could not be loaded.",
        signal,
      );

      const projects = requireArray(data)
        .flatMap((row) => {
          try {
            return [normalizeProject(row)];
          } catch {
            return [];
          }
        })
        .filter(
          (project, index, list) =>
            list.findIndex((item) => item.id === project.id) === index,
        );

      registerProjectDirectories(
        projects.map((project) => project.worktree),
      );

      return projects;
    },

    async listProjectSessions(directory, signal) {
      const scope = validateProjectDirectory(directory);
      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.session.list(
            { directory: scope },
            { signal: requestSignal },
          ),
        "Sessions could not be loaded.",
        signal,
      );

      return requireArray(data).filter(
        (session) => session?.directory === scope,
      );
    },

    async createProjectSession(directory, { title, model } = {}, signal) {
      const scope = validateProjectDirectory(directory);
      const normalizedModel = validateModel(model);
      const body = {
        directory: scope,
        title:
          typeof title === "string" && title.trim()
            ? title.trim().slice(0, MAX_SESSION_TITLE_CHARS)
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
        data.directory !== scope
      ) {
        throw unexpectedResponse();
      }

      return data;
    },

    async updateSession(
      directory,
      sessionID,
      { title, archived } = {},
      signal,
    ) {
      const scope = validateProjectDirectory(directory);
      const id = validateSessionId(sessionID);
      const update = { sessionID: id, directory: scope };

      if (title !== undefined) {
        update.title = validateSessionTitle(title);
      }

      if (archived !== undefined) {
        if (
          !Number.isSafeInteger(archived) ||
          archived < 0
        ) {
          throw invalidInput("The session archive time is invalid.");
        }

        update.time = { archived };
      }

      if (update.title === undefined && update.time === undefined) {
        throw invalidInput("No session changes were provided.");
      }

      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.session.update(update, { signal: requestSignal }),
        "The session could not be updated.",
        signal,
      );

      if (
        !data ||
        typeof data !== "object" ||
        data.id !== id ||
        data.directory !== scope
      ) {
        throw unexpectedResponse();
      }

      return data;
    },

    async deleteSession(directory, sessionID, signal) {
      const scope = validateProjectDirectory(directory);
      const id = validateSessionId(sessionID);

      return runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.session.delete(
            { sessionID: id, directory: scope },
            { signal: requestSignal },
          ),
        "The session could not be deleted.",
        signal,
      );
    },

    async listPermissions(directory, signal) {
      const scope = validateProjectDirectory(directory);
      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.permission.list(
            { directory: scope },
            { signal: requestSignal },
          ),
        "Permission requests could not be loaded.",
        signal,
      );

      return requireArray(data).flatMap((row) => {
        try {
          return [normalizePermission(row)];
        } catch {
          return [];
        }
      });
    },

    async replyPermission(
      directory,
      requestID,
      { reply, message } = {},
      signal,
    ) {
      const scope = validateProjectDirectory(directory);
      const id = validatePermissionId(requestID);
      const body = validatePermissionReply(reply, message);

      return runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.permission.reply(
            {
              requestID: id,
              directory: scope,
              ...body,
            },
            { signal: requestSignal },
          ),
        "The permission response could not be sent.",
        signal,
      );
    },

    async listSessionMessages(directory, sessionID, signal) {
      const scope = validateProjectDirectory(directory);
      const id = validateSessionId(sessionID);
      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.session.messages(
            {
              sessionID: id,
              directory: scope,
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

    async getSessionStatuses(directory, signal) {
      const scope = validateProjectDirectory(directory);
      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.session.status(
            { directory: scope },
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
      directory,
      sessionID,
      { text, model, agent } = {},
      signal,
    ) {
      const scope = validateProjectDirectory(directory);
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
              directory: scope,
              ...body,
            },
            { signal: requestSignal },
          ),
        "The prompt could not be sent.",
        signal,
      );
    },

    async sendCommand(
      directory,
      sessionID,
      { command, arguments: args, model, agent } = {},
      signal,
    ) {
      const scope = validateProjectDirectory(directory);
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
              directory: scope,
              ...body,
            },
            { signal: requestSignal },
          ),
        "The command could not be sent.",
        signal,
      );
    },

    async abortSession(directory, sessionID, signal) {
      const scope = validateProjectDirectory(directory);
      const id = validateSessionId(sessionID);

      return runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.session.abort(
            { sessionID: id, directory: scope },
            { signal: requestSignal },
          ),
        "The agent could not be stopped.",
        signal,
      );
    },

    async listProjectFiles(directory, path = ".", signal) {
      const scope = validateProjectDirectory(directory);
      const target = validateFilePath(path, { allowRoot: true });
      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.file.list(
            { directory: scope, path: target },
            { signal: requestSignal },
          ),
        "Project files could not be loaded.",
        signal,
      );

      return normalizeFileNodes(scope, requireArray(data));
    },

    async readProjectFile(directory, path, signal) {
      const scope = validateProjectDirectory(directory);
      const target = validateFilePath(path);
      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.file.read(
            { directory: scope, path: target },
            { signal: requestSignal },
          ),
        "The file could not be opened.",
        signal,
      );

      return normalizeFileContent(data);
    },

    async searchProjectFiles(directory, query, signal) {
      const scope = validateProjectDirectory(directory);
      const search = validateFileSearch(query);
      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.find.files(
            {
              directory: scope,
              query: search,
              type: "file",
              limit: MAX_FILE_SEARCH_RESULTS,
            },
            { signal: requestSignal },
          ),
        "Files could not be searched.",
        signal,
      );

      return [
        ...new Set(
          requireArray(data).flatMap((value) => {
            const path = normalizeProjectPath(value);
            return path ? [path] : [];
          }),
        ),
      ];
    },

    async applyProjectPatch(directory, patch, signal) {
      const scope = validateProjectDirectory(directory);

      if (!validateFilePatch(patch)) {
        throw invalidInput("The file change is not a safe single-file patch.");
      }

      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.vcs.apply(
            { directory: scope, patch },
            { signal: requestSignal },
          ),
        "The file could not be saved.",
        signal,
      );

      if (
        !data ||
        typeof data !== "object" ||
        data.applied !== true
      ) {
        throw unexpectedResponse();
      }

      return data;
    },

    async listProviders(directory, signal) {
      const scope = validateProjectDirectory(directory);
      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.config.providers(
            { directory: scope },
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

    async listCommands(directory, signal) {
      const scope = validateProjectDirectory(directory);
      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.command.list(
            { directory: scope },
            { signal: requestSignal },
          ),
        "Commands could not be loaded.",
        signal,
      );

      return requireArray(data);
    },

    async getVcsStatus(directory, signal) {
      const scope = validateProjectDirectory(directory);
      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.vcs.status(
            { directory: scope },
            { signal: requestSignal },
          ),
        "Changes could not be loaded.",
        signal,
      );

      return requireArray(data);
    },

    async getVcsDiff(
      directory,
      { mode = "git", context = 3 } = {},
      signal,
    ) {
      const scope = validateProjectDirectory(directory);

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
              directory: scope,
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

export const listProjects = (signal) =>
  opencodeApi.listProjects(signal);

export const listProjectSessions = (directory, signal) =>
  opencodeApi.listProjectSessions(directory, signal);

export const createProjectSession = (directory, options, signal) =>
  opencodeApi.createProjectSession(directory, options, signal);

export const updateSession = (directory, sessionID, options, signal) =>
  opencodeApi.updateSession(directory, sessionID, options, signal);

export const deleteSession = (directory, sessionID, signal) =>
  opencodeApi.deleteSession(directory, sessionID, signal);

export const listPermissions = (directory, signal) =>
  opencodeApi.listPermissions(directory, signal);

export const replyPermission = (directory, requestID, options, signal) =>
  opencodeApi.replyPermission(directory, requestID, options, signal);

export const listSessionMessages = (directory, sessionID, signal) =>
  opencodeApi.listSessionMessages(directory, sessionID, signal);

export const getSessionStatuses = (directory, signal) =>
  opencodeApi.getSessionStatuses(directory, signal);

export const sendPromptAsync = (directory, sessionID, options, signal) =>
  opencodeApi.sendPromptAsync(directory, sessionID, options, signal);

export const sendCommand = (directory, sessionID, options, signal) =>
  opencodeApi.sendCommand(directory, sessionID, options, signal);

export const abortSession = (directory, sessionID, signal) =>
  opencodeApi.abortSession(directory, sessionID, signal);

export const listProviders = (directory, signal) =>
  opencodeApi.listProviders(directory, signal);

export const listCommands = (directory, signal) =>
  opencodeApi.listCommands(directory, signal);

export const getVcsStatus = (directory, signal) =>
  opencodeApi.getVcsStatus(directory, signal);

export const getVcsDiff = (directory, options, signal) =>
  opencodeApi.getVcsDiff(directory, options, signal);

export const listProjectFiles = (directory, path, signal) =>
  opencodeApi.listProjectFiles(directory, path, signal);

export const readProjectFile = (directory, path, signal) =>
  opencodeApi.readProjectFile(directory, path, signal);

export const searchProjectFiles = (directory, query, signal) =>
  opencodeApi.searchProjectFiles(directory, query, signal);

export const applyProjectPatch = (directory, patch, signal) =>
  opencodeApi.applyProjectPatch(directory, patch, signal);
