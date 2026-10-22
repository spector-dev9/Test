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
import { validateTerminalCommand } from "./terminal.js";
import {
  isPtyId,
  normalizePtyInfo,
  normalizePtyTitle,
  ptyCwdMatches,
  validateTerminalSize,
} from "./pty.js";
import {
  MAX_PROMPT_ATTACHMENTS,
  normalizeImageAttachments,
} from "./attachments.js";

export { PROJECT_DIRECTORY };

const SESSION_ID_PATTERN = /^ses_[A-Za-z0-9]+$/;
const MESSAGE_ID_PATTERN = /^msg_[A-Za-z0-9]+$/;
const QUESTION_ID_PATTERN = /^que_[A-Za-z0-9]+$/;
const PERMISSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
const MODEL_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const MODEL_VARIANT_PATTERN = /^[A-Za-z0-9._:-]{1,40}$/;
const AGENT_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const COMMAND_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAX_PROMPT_CHARS = 32000;
const MAX_SESSION_TITLE_CHARS = 120;
const MAX_PERMISSION_MESSAGE_CHARS = 2000;
const MAX_QUESTION_HEADER_CHARS = 120;
const MAX_QUESTION_TEXT_CHARS = 4000;
const MAX_QUESTION_OPTION_CHARS = 500;
const MAX_QUESTION_DESCRIPTION_CHARS = 1000;
const MAX_QUESTION_ANSWERS = 20;
const MESSAGE_PAGE_LIMIT = 200;
const PERMISSION_REPLIES = ["once", "always", "reject"];
const TODO_STATUSES = new Set([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);
const TODO_PRIORITIES = new Set(["high", "medium", "low"]);

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

const MAX_SHELL_ARGS = 64;
const MAX_SHELL_ARG_CHARS = 4096;
const MAX_SHELL_ENV_KEYS = 32;
const SHELL_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Validate a custom terminal command.
 *
 * The app asks the local server to start a shell for the project terminal.
 * A guest Alpine shell is one of those commands, so the shape is checked
 * before it reaches the server: absolute paths only, a bounded argument
 * list, and a small, well-known environment.
 */
export function normalizeShellRequest({ command, args, cwd, env } = {}) {
  if (typeof command !== "string" || !command.trim()) return null;
  if (!command.startsWith("/") || command.includes("\0")) return null;
  if (command.length > 4096) return null;

  const normalizedArgs = [];
  if (Array.isArray(args)) {
    for (const argument of args.slice(0, MAX_SHELL_ARGS)) {
      if (typeof argument !== "string") continue;
      if (argument.includes("\0")) continue;
      if (argument.length > MAX_SHELL_ARG_CHARS) continue;
      normalizedArgs.push(argument);
    }
  }

  let workingDirectory;
  if (typeof cwd === "string" && cwd.startsWith("/") && cwd.length <= 4096) {
    workingDirectory = cwd;
  }

  const normalizedEnv = {};
  if (env && typeof env === "object" && !Array.isArray(env)) {
    for (const [key, value] of Object.entries(env).slice(
      0,
      MAX_SHELL_ENV_KEYS,
    )) {
      if (!SHELL_ENV_KEY.test(key)) continue;
      if (typeof value !== "string" || value.length > 4096) continue;
      if (value.includes("\0")) continue;
      normalizedEnv[key] = value;
    }
  }

  return {
    command: command.trim(),
    args: normalizedArgs,
    ...(workingDirectory ? { cwd: workingDirectory } : {}),
    ...(Object.keys(normalizedEnv).length > 0 ? { env: normalizedEnv } : {}),
  };
}

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

const MAX_SERVER_ERROR_CHARS = 500;

function serverErrorMessage(error) {
  const detail =
    typeof error?.data?.message === "string"
      ? error.data.message
      : typeof error?.message === "string"
        ? error.message
        : "";
  const message = detail
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SERVER_ERROR_CHARS);

  if (!message) return "";

  const reference =
    typeof error?.data?.ref === "string" &&
    /^err_[A-Za-z0-9]+$/.test(error.data.ref)
      ? error.data.ref
      : "";

  return reference && !message.includes(reference)
    ? `${message} (${reference})`
    : message;
}

function httpFailure(status, error) {
  return new OpenCodeConnectionError(
    CONNECTION_ERROR_KINDS.HTTP,
    serverErrorMessage(error) ||
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

function validateMessageId(messageID) {
  if (
    typeof messageID !== "string" ||
    !MESSAGE_ID_PATTERN.test(messageID)
  ) {
    throw invalidInput("The message identifier is invalid.");
  }

  return messageID;
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

function validatePtyId(ptyID) {
  if (!isPtyId(ptyID)) {
    throw invalidInput("The terminal identifier is invalid.");
  }

  return ptyID;
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

function validateQuestionId(requestID) {
  if (
    typeof requestID !== "string" ||
    !QUESTION_ID_PATTERN.test(requestID)
  ) {
    throw invalidInput("The question request identifier is invalid.");
  }

  return requestID;
}

function validateQuestionAnswers(answers) {
  if (
    !Array.isArray(answers) ||
    answers.length === 0 ||
    answers.length > MAX_QUESTION_ANSWERS
  ) {
    throw invalidInput("The question answers are invalid.");
  }

  return answers.map((answer) => {
    if (
      !Array.isArray(answer) ||
      answer.length === 0 ||
      answer.length > MAX_QUESTION_ANSWERS
    ) {
      throw invalidInput("The question answers are invalid.");
    }

    return answer.map((label) => {
      if (
        typeof label !== "string" ||
        !label.trim() ||
        label.length > MAX_QUESTION_OPTION_CHARS ||
        label.includes("\0")
      ) {
        throw invalidInput("The question answers are invalid.");
      }

      return label.trim();
    });
  });
}

function normalizeQuestionOption(data) {
  if (
    !data ||
    typeof data !== "object" ||
    typeof data.label !== "string" ||
    !data.label.trim() ||
    data.label.length > MAX_QUESTION_OPTION_CHARS
  ) {
    throw unexpectedResponse();
  }

  return {
    label: data.label.trim(),
    description:
      typeof data.description === "string"
        ? data.description.trim().slice(0, MAX_QUESTION_DESCRIPTION_CHARS)
        : "",
  };
}

function normalizeQuestion(data) {
  if (
    !data ||
    typeof data !== "object" ||
    typeof data.id !== "string" ||
    !QUESTION_ID_PATTERN.test(data.id) ||
    typeof data.sessionID !== "string" ||
    !SESSION_ID_PATTERN.test(data.sessionID) ||
    !Array.isArray(data.questions) ||
    data.questions.length === 0 ||
    data.questions.length > MAX_QUESTION_ANSWERS
  ) {
    throw unexpectedResponse();
  }

  const questions = data.questions.map((question) => {
    if (
      !question ||
      typeof question !== "object" ||
      typeof question.question !== "string" ||
      !question.question.trim() ||
      question.question.length > MAX_QUESTION_TEXT_CHARS ||
      typeof question.header !== "string" ||
      !question.header.trim() ||
      question.header.length > MAX_QUESTION_HEADER_CHARS ||
      !Array.isArray(question.options) ||
      question.options.length > MAX_QUESTION_ANSWERS
    ) {
      throw unexpectedResponse();
    }

    return {
      question: question.question.trim(),
      header: question.header.trim(),
      options: question.options.map(normalizeQuestionOption),
      multiple: question.multiple === true,
      custom: question.custom === true,
    };
  });

  return {
    id: data.id,
    sessionID: data.sessionID,
    questions,
  };
}

function normalizeTodo(data) {
  if (
    !data ||
    typeof data !== "object" ||
    typeof data.content !== "string" ||
    !data.content.trim() ||
    data.content.length > MAX_QUESTION_TEXT_CHARS ||
    !TODO_STATUSES.has(data.status) ||
    !TODO_PRIORITIES.has(data.priority)
  ) {
    throw unexpectedResponse();
  }

  return {
    content: data.content.trim(),
    status: data.status,
    priority: data.priority,
  };
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
    !MODEL_ID_PATTERN.test(model.modelID) ||
    (model.variant != null &&
      (typeof model.variant !== "string" ||
        !MODEL_VARIANT_PATTERN.test(model.variant)))
  ) {
    throw invalidInput("The selected model is invalid.");
  }

  return {
    providerID: model.providerID,
    modelID: model.modelID,
    ...(model.variant ? { variant: model.variant } : {}),
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

function normalizeAgent(agent) {
  if (!agent || typeof agent !== "object") return null;
  if (typeof agent.name !== "string" || !agent.name.trim()) return null;
  if (!AGENT_ID_PATTERN.test(agent.name)) return null;

  const mode =
    agent.mode === "primary" || agent.mode === "subagent" || agent.mode === "all"
      ? agent.mode
      : "all";

  return {
    name: agent.name.trim(),
    description:
      typeof agent.description === "string"
        ? agent.description.trim().slice(0, 400)
        : "",
    mode,
    hidden: agent.hidden === true,
  };
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
      throw httpFailure(status, result.error);
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
          ...(normalizedModel.variant
            ? { variant: normalizedModel.variant }
            : {}),
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

    async revertSessionMessage(
      directory,
      sessionID,
      messageID,
      signal,
    ) {
      const scope = validateProjectDirectory(directory);
      const id = validateSessionId(sessionID);
      const message = validateMessageId(messageID);

      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.session.revert(
            {
              sessionID: id,
              directory: scope,
              messageID: message,
            },
            { signal: requestSignal },
          ),
        "The message could not be reverted.",
        signal,
      );

      if (
        !data ||
        typeof data !== "object" ||
        data.id !== id ||
        data.directory !== scope ||
        !data.revert ||
        !MESSAGE_ID_PATTERN.test(data.revert.messageID ?? "")
      ) {
        throw unexpectedResponse();
      }

      return data;
    },

    async restoreRevertedSession(directory, sessionID, signal) {
      const scope = validateProjectDirectory(directory);
      const id = validateSessionId(sessionID);

      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.session.unrevert(
            { sessionID: id, directory: scope },
            { signal: requestSignal },
          ),
        "The reverted messages could not be restored.",
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

    async listQuestions(directory, signal) {
      const scope = validateProjectDirectory(directory);
      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.question.list(
            { directory: scope },
            { signal: requestSignal },
          ),
        "Questions could not be loaded.",
        signal,
      );

      return requireArray(data).flatMap((row) => {
        try {
          return [normalizeQuestion(row)];
        } catch {
          return [];
        }
      });
    },

    async replyQuestion(directory, requestID, answers, signal) {
      const scope = validateProjectDirectory(directory);
      const id = validateQuestionId(requestID);
      const normalized = validateQuestionAnswers(answers);

      return runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.question.reply(
            {
              requestID: id,
              directory: scope,
              answers: normalized,
            },
            { signal: requestSignal },
          ),
        "The question response could not be sent.",
        signal,
      );
    },

    async rejectQuestion(directory, requestID, signal) {
      const scope = validateProjectDirectory(directory);
      const id = validateQuestionId(requestID);

      return runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.question.reject(
            {
              requestID: id,
              directory: scope,
            },
            { signal: requestSignal },
          ),
        "The question could not be rejected.",
        signal,
      );
    },

    async listSessionTodos(directory, sessionID, signal) {
      const scope = validateProjectDirectory(directory);
      const id = validateSessionId(sessionID);
      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.session.todo(
            {
              sessionID: id,
              directory: scope,
            },
            { signal: requestSignal },
          ),
        "The todo list could not be loaded.",
        signal,
      );

      return requireArray(data).flatMap((row) => {
        try {
          return [normalizeTodo(row)];
        } catch {
          return [];
        }
      });
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
      { text, model, agent, attachments } = {},
      signal,
    ) {
      const scope = validateProjectDirectory(directory);
      const id = validateSessionId(sessionID);
      const normalizedModel = validateModel(model);
      const normalizedAgent = validateAgent(agent);
      const prompt = validatePromptText(text);
      const normalizedAttachments =
        attachments == null ? [] : normalizeImageAttachments(attachments);

      if (normalizedAttachments === null) {
        throw invalidInput(
          `Attach up to ${MAX_PROMPT_ATTACHMENTS} PNG, JPEG, WebP, or GIF images.`,
        );
      }

      const body = {
        parts: [
          { type: "text", text: prompt },
          ...normalizedAttachments.map((attachment) => ({
            type: "file",
            mime: attachment.mime,
            filename: attachment.filename,
            url: attachment.url,
          })),
        ],
      };

      if (normalizedModel) {
        body.model = {
          providerID: normalizedModel.providerID,
          modelID: normalizedModel.modelID,
        };

        if (normalizedModel.variant) {
          body.variant = normalizedModel.variant;
        }
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
      const normalizedModel = validateModel(model);
      const normalizedAgent = validateAgent(agent);

      const body = {
        command: name,
        arguments: normalizedArguments,
      };

      if (normalizedModel) {
        body.model = `${normalizedModel.providerID}/${normalizedModel.modelID}`;

        if (normalizedModel.variant) {
          body.variant = normalizedModel.variant;
        }
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

    async runProjectShell(
      directory,
      sessionID,
      { command, agent = "build" } = {},
      signal,
    ) {
      const scope = validateProjectDirectory(directory);
      const id = validateSessionId(sessionID);
      const normalizedCommand = validateTerminalCommand(command);
      const normalizedAgent = validateAgent(agent);

      if (!normalizedCommand) {
        throw invalidInput("Enter a valid shell command.");
      }

      if (!normalizedAgent) {
        throw invalidInput("The selected agent is invalid.");
      }

      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.session.shell(
            {
              sessionID: id,
              directory: scope,
              command: normalizedCommand,
              agent: normalizedAgent,
            },
            { signal: requestSignal },
          ),
        "The command could not be run.",
        signal,
      );

      if (
        !data ||
        typeof data !== "object" ||
        !Array.isArray(data.parts)
      ) {
        throw unexpectedResponse();
      }

      return data;
    },

    async createProjectTerminal(
      directory,
      { title, command, args, cwd, env } = {},
      signal,
    ) {
      const scope = validateProjectDirectory(directory);
      const body = {
        directory: scope,
        title: normalizePtyTitle(title),
      };

      const shell = normalizeShellRequest({ command, args, cwd, env });
      if (shell) {
        Object.assign(body, shell);
      }

      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.pty.create(body, { signal: requestSignal }),
        "The terminal could not be started.",
        signal,
      );
      if (
        data &&
        typeof data === "object" &&
        typeof data.cwd === "string" &&
        !ptyCwdMatches(data.cwd, scope)
      ) {
        throw new OpenCodeConnectionError(
          CONNECTION_ERROR_KINDS.INVALID,
          `The terminal started in ${data.cwd}, not the project folder ${scope}.`,
        );
      }

      const terminal = normalizePtyInfo(data, scope);

      if (!terminal) {
        throw new OpenCodeConnectionError(
          CONNECTION_ERROR_KINDS.INVALID,
          "The terminal server returned an unexpected terminal response.",
        );
      }

      return terminal;
    },

    async listProjectTerminals(directory, signal) {
      const scope = validateProjectDirectory(directory);
      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.pty.list(
            { directory: scope },
            { signal: requestSignal },
          ),
        "Terminal sessions could not be loaded.",
        signal,
      );

      return requireArray(data)
        .map((row) => normalizePtyInfo(row, scope))
        .filter(Boolean);
    },

    async resizeProjectTerminal(directory, ptyID, size, signal) {
      const scope = validateProjectDirectory(directory);
      const id = validatePtyId(ptyID);
      const normalizedSize = validateTerminalSize(size?.cols, size?.rows);

      if (!normalizedSize) {
        throw invalidInput("The terminal size is invalid.");
      }

      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.pty.update(
            {
              ptyID: id,
              directory: scope,
              size: normalizedSize,
            },
            { signal: requestSignal },
          ),
        "The terminal could not be resized.",
        signal,
      );
      const terminal = normalizePtyInfo(data, scope);

      if (!terminal) throw unexpectedResponse();

      return terminal;
    },

    async removeProjectTerminal(directory, ptyID, signal) {
      const scope = validateProjectDirectory(directory);
      const id = validatePtyId(ptyID);

      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.pty.remove(
            { ptyID: id, directory: scope },
            { signal: requestSignal },
          ),
        "The terminal could not be closed.",
        signal,
      );

      if (data !== true) throw unexpectedResponse();

      return true;
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

    async listConnectedProviders(directory, signal) {
      const scope = validateProjectDirectory(directory);
      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.provider.list(
            { directory: scope },
            { signal: requestSignal },
          ),
        "GitHub sign-in status could not be loaded.",
        signal,
      );

      if (!data || typeof data !== "object" || !Array.isArray(data.connected)) {
        throw unexpectedResponse();
      }

      return [
        ...new Set(
          data.connected.filter(
            (id) => typeof id === "string" && AGENT_ID_PATTERN.test(id),
          ),
        ),
      ];
    },

    async authorizeGitHubCopilot(directory, signal) {
      const scope = validateProjectDirectory(directory);
      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.provider.oauth.authorize(
            {
              providerID: "github-copilot",
              directory: scope,
              method: 0,
              inputs: { deploymentType: "github.com" },
            },
            { signal: requestSignal },
          ),
        "GitHub sign-in could not be started.",
        signal,
      );

      let url;

      try {
        url = new URL(data?.url);
      } catch {
        throw unexpectedResponse();
      }

      if (
        url.protocol !== "https:" ||
        url.href.length > 2000 ||
        typeof data.instructions !== "string" ||
        data.instructions.length > 500
      ) {
        throw unexpectedResponse();
      }

      return {
        url: url.href,
        instructions: data.instructions,
        method: data.method === "code" ? "code" : "auto",
      };
    },

    async completeGitHubCopilot(directory, signal) {
      const scope = validateProjectDirectory(directory);
      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.provider.oauth.callback(
            {
              providerID: "github-copilot",
              directory: scope,
              method: 0,
            },
            { signal: requestSignal },
          ),
        "GitHub sign-in could not be completed.",
        signal,
      );

      if (data !== true) {
        throw unexpectedResponse();
      }

      return true;
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

    async listAgents(directory, signal) {
      const scope = validateProjectDirectory(directory);
      const data = await runRequest(
        client,
        (currentClient, requestSignal) =>
          currentClient.app.agents(
            { directory: scope },
            { signal: requestSignal },
          ),
        "Agents could not be loaded.",
        signal,
      );

      return requireArray(data)
        .map((agent) => normalizeAgent(agent))
        .filter(Boolean);
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

export const revertSessionMessage = (
  directory,
  sessionID,
  messageID,
  signal,
) =>
  opencodeApi.revertSessionMessage(
    directory,
    sessionID,
    messageID,
    signal,
  );

export const restoreRevertedSession = (directory, sessionID, signal) =>
  opencodeApi.restoreRevertedSession(directory, sessionID, signal);

export const listPermissions = (directory, signal) =>
  opencodeApi.listPermissions(directory, signal);

export const replyPermission = (directory, requestID, options, signal) =>
  opencodeApi.replyPermission(directory, requestID, options, signal);

export const listQuestions = (directory, signal) =>
  opencodeApi.listQuestions(directory, signal);

export const replyQuestion = (directory, requestID, answers, signal) =>
  opencodeApi.replyQuestion(directory, requestID, answers, signal);

export const rejectQuestion = (directory, requestID, signal) =>
  opencodeApi.rejectQuestion(directory, requestID, signal);

export const listSessionTodos = (directory, sessionID, signal) =>
  opencodeApi.listSessionTodos(directory, sessionID, signal);

export const listSessionMessages = (directory, sessionID, signal) =>
  opencodeApi.listSessionMessages(directory, sessionID, signal);

export const getSessionStatuses = (directory, signal) =>
  opencodeApi.getSessionStatuses(directory, signal);

export const sendPromptAsync = (directory, sessionID, options, signal) =>
  opencodeApi.sendPromptAsync(directory, sessionID, options, signal);

export const sendCommand = (directory, sessionID, options, signal) =>
  opencodeApi.sendCommand(directory, sessionID, options, signal);

export const listAgents = (directory, signal) =>
  opencodeApi.listAgents(directory, signal);

export const runProjectShell = (directory, sessionID, options, signal) =>
  opencodeApi.runProjectShell(directory, sessionID, options, signal);

export const createProjectTerminal = (directory, options, signal) =>
  opencodeApi.createProjectTerminal(directory, options, signal);

export const listProjectTerminals = (directory, signal) =>
  opencodeApi.listProjectTerminals(directory, signal);

export const resizeProjectTerminal = (directory, ptyID, size, signal) =>
  opencodeApi.resizeProjectTerminal(directory, ptyID, size, signal);

export const removeProjectTerminal = (directory, ptyID, signal) =>
  opencodeApi.removeProjectTerminal(directory, ptyID, signal);

export const abortSession = (directory, sessionID, signal) =>
  opencodeApi.abortSession(directory, sessionID, signal);

export const listProviders = (directory, signal) =>
  opencodeApi.listProviders(directory, signal);

export const listConnectedProviders = (directory, signal) =>
  opencodeApi.listConnectedProviders(directory, signal);

export const authorizeGitHubCopilot = (directory, signal) =>
  opencodeApi.authorizeGitHubCopilot(directory, signal);

export const completeGitHubCopilot = (directory, signal) =>
  opencodeApi.completeGitHubCopilot(directory, signal);

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
