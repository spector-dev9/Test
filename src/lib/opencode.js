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

export async function checkConnection(signal) {
  ensureConfigured();

  let result;
  try {
    result = await executeRequest(
      (requestSignal) => opencode.global.health({ signal: requestSignal }),
      signal,
    );
  } catch (error) {
    throw normalizeRequestFailure(error);
  }

  return validateHealthPayload(
    unwrapOpenCodeResult(
      result,
      "The OpenCode server could not be reached.",
    ),
  );
}

export async function listProjectSessions(signal) {
  ensureConfigured();

  let result;
  try {
    result = await executeRequest(
      (requestSignal) =>
        opencode.session.list({
          directory: PROJECT_DIRECTORY,
          signal: requestSignal,
        }),
      signal,
    );
  } catch (error) {
    throw normalizeRequestFailure(error);
  }

  const data = unwrapOpenCodeResult(result, "Sessions could not be loaded.");

  if (!Array.isArray(data)) {
    throw unexpectedResponse();
  }

  return data.filter((session) => session?.directory === PROJECT_DIRECTORY);
}
