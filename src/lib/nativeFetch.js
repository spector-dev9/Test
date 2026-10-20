import { Capacitor, CapacitorHttp } from "@capacitor/core";
import {
  CONNECTION_ERROR_KINDS,
  NATIVE_OPENCODE_ORIGIN,
  OpenCodeConnectionError,
} from "./connection.js";
import { isAllowedProjectDirectory } from "./projectScope.js";

const HEALTH_PATH = "/global/health";
const PROJECT_PATH = "/project";
const PERMISSION_PATH = "/permission";
const SESSION_PATH = "/session";
const SESSION_STATUS_PATH = "/session/status";
const SESSION_ITEM_PATH = /^\/session\/(ses_[A-Za-z0-9]+)\/(message|prompt_async|command|abort)$/;
const SESSION_RESOURCE_PATH = /^\/session\/(ses_[A-Za-z0-9]+)$/;
const PERMISSION_REPLY_PATH = /^\/permission\/([A-Za-z0-9_-]{1,200})\/reply$/;
const PROVIDERS_PATH = "/config/providers";
const COMMANDS_PATH = "/command";
const VCS_STATUS_PATH = "/vcs/status";
const VCS_DIFF_PATH = "/vcs/diff";
const MODEL_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const MODEL_REF_PATTERN = /^[A-Za-z0-9._:-]+\/[A-Za-z0-9._:-]+$/;
const AGENT_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const COMMAND_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAX_PROMPT_CHARS = 32000;
const MAX_SESSION_TITLE_CHARS = 120;
const MAX_PERMISSION_MESSAGE_CHARS = 2000;
const PERMISSION_REPLIES = ["once", "always", "reject"];

export const MAX_REQUEST_BYTES = 256 * 1024;
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

const OMITTED_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
]);

function invalidRequest(message) {
  return new TypeError(`Native OpenCode transport ${message}`);
}

function nativeResponseBody(data) {
  if (data == null) return "";
  if (typeof data === "string") return data;

  try {
    const serialized = JSON.stringify(data);
    if (typeof serialized !== "string") {
      throw new TypeError();
    }
    return serialized;
  } catch {
    throw new TypeError("Native OpenCode transport received malformed data.");
  }
}

function nativeResponseHeaders(headers) {
  const result = new Headers();

  if (!headers || typeof headers !== "object") {
    return result;
  }

  for (const [name, value] of Object.entries(headers)) {
    if (OMITTED_RESPONSE_HEADERS.has(name.toLowerCase()) || value == null) {
      continue;
    }

    try {
      result.set(name, String(value));
    } catch {
      continue;
    }
  }

  return result;
}

function declaredContentLength(headers) {
  if (!headers || typeof headers !== "object") return null;

  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== "content-length") continue;

    const normalized = String(value).trim();
    if (!/^\d+$/.test(normalized)) return null;

    const length = Number(normalized);
    return Number.isSafeInteger(length) ? length : null;
  }

  return null;
}

function isTimeoutFailure(error) {
  if (error?.code === "SocketTimeoutException") return true;

  return /(?:connect|read) timed out|timeout/i.test(
    typeof error?.message === "string" ? error.message : "",
  );
}

function abortError() {
  return new DOMException(
    "The OpenCode request was cancelled.",
    "AbortError",
  );
}

function queryEntries(url) {
  return [...url.searchParams.entries()];
}

function requireProjectQuery(url, extraKeys = []) {
  const entries = queryEntries(url);
  const directoryEntries = entries.filter(
    ([key]) => key === "directory",
  );

  if (
    directoryEntries.length !== 1 ||
    !isAllowedProjectDirectory(directoryEntries[0][1])
  ) {
    throw invalidRequest("requires a known project directory.");
  }

  for (const [key] of entries) {
    if (key !== "directory" && !extraKeys.includes(key)) {
      throw invalidRequest("rejected an unsupported query parameter.");
    }
  }
}

function requireIntegerQuery(url, key, min, max) {
  const values = url.searchParams.getAll(key);
  if (values.length !== 1 || !/^\d+$/.test(values[0])) {
    throw invalidRequest(`requires a valid ${key} query.`);
  }

  const value = Number(values[0]);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw invalidRequest(`requires a valid ${key} query.`);
  }

  return value;
}

function exactKeys(value, allowed) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw invalidRequest("requires a JSON object.");
  }

  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw invalidRequest("rejected unsupported request fields.");
  }
}

function isModelId(value) {
  return typeof value === "string" && MODEL_ID_PATTERN.test(value);
}

function validateCreateBody(body) {
  exactKeys(body, ["title", "model"]);

  if (
    typeof body.title !== "string" ||
    !body.title.trim() ||
    body.title.length > 120
  ) {
    throw invalidRequest("requires a valid session title.");
  }

  if (body.model !== undefined) {
    exactKeys(body.model, ["id", "providerID"]);
    if (
      !isModelId(body.model.id) ||
      !isModelId(body.model.providerID)
    ) {
      throw invalidRequest("rejected an invalid model.");
    }
  }
}

function validatePromptBody(body) {
  exactKeys(body, ["parts", "model", "agent"]);

  if (!Array.isArray(body.parts) || body.parts.length !== 1) {
    throw invalidRequest("requires exactly one text part.");
  }

  exactKeys(body.parts[0], ["type", "text"]);
  if (
    body.parts[0].type !== "text" ||
    typeof body.parts[0].text !== "string" ||
    !body.parts[0].text.trim() ||
    body.parts[0].text.length > MAX_PROMPT_CHARS
  ) {
    throw invalidRequest("requires a valid text part.");
  }

  if (body.model !== undefined) {
    exactKeys(body.model, ["providerID", "modelID"]);
    if (
      !isModelId(body.model.providerID) ||
      !isModelId(body.model.modelID)
    ) {
      throw invalidRequest("rejected an invalid model.");
    }
  }

  if (
    body.agent !== undefined &&
    (typeof body.agent !== "string" ||
      !AGENT_ID_PATTERN.test(body.agent))
  ) {
    throw invalidRequest("rejected an invalid agent.");
  }
}

function validateCommandBody(body) {
  exactKeys(body, ["command", "arguments", "model", "agent"]);

  if (
    typeof body.command !== "string" ||
    !COMMAND_NAME_PATTERN.test(body.command)
  ) {
    throw invalidRequest("requires a valid command.");
  }

  if (
    typeof body.arguments !== "string" ||
    body.arguments.length > MAX_PROMPT_CHARS
  ) {
    throw invalidRequest("requires valid command arguments.");
  }

  if (
    body.model !== undefined &&
    (typeof body.model !== "string" ||
      !MODEL_REF_PATTERN.test(body.model))
  ) {
    throw invalidRequest("rejected an invalid model.");
  }

  if (
    body.agent !== undefined &&
    (typeof body.agent !== "string" ||
      !AGENT_ID_PATTERN.test(body.agent))
  ) {
    throw invalidRequest("rejected an invalid agent.");
  }
}

function validateSessionUpdateBody(body) {
  exactKeys(body, ["title", "time"]);

  if (body.title === undefined && body.time === undefined) {
    throw invalidRequest("requires a session change.");
  }

  if (body.title !== undefined) {
    if (
      typeof body.title !== "string" ||
      !body.title.trim() ||
      body.title.trim().length > MAX_SESSION_TITLE_CHARS
    ) {
      throw invalidRequest("requires a valid session title.");
    }
  }

  if (body.time !== undefined) {
    exactKeys(body.time, ["archived"]);

    if (
      !Number.isSafeInteger(body.time.archived) ||
      body.time.archived < 0
    ) {
      throw invalidRequest("requires a valid archive time.");
    }
  }
}

function validatePermissionReplyBody(body) {
  exactKeys(body, ["reply", "message"]);

  if (!PERMISSION_REPLIES.includes(body.reply)) {
    throw invalidRequest("requires a valid permission response.");
  }

  if (
    body.message !== undefined &&
    (typeof body.message !== "string" ||
      body.message.length > MAX_PERMISSION_MESSAGE_CHARS)
  ) {
    throw invalidRequest("rejected an invalid permission message.");
  }
}

async function requestBody(request, { allowEmpty = false } = {}) {
  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isSafeInteger(contentLength) &&
    contentLength > MAX_REQUEST_BYTES
  ) {
    throw invalidRequest("rejected an oversized request.");
  }

  const text = await request.text();
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > MAX_REQUEST_BYTES) {
    throw invalidRequest("rejected an oversized request.");
  }

  if (!text) {
    if (allowEmpty) return null;
    throw invalidRequest("requires a JSON request body.");
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw invalidRequest("requires a JSON content type.");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw invalidRequest("requires valid JSON.");
  }
}

function validateReadRequest(url) {
  if (url.pathname === HEALTH_PATH) {
    if (url.search) {
      throw invalidRequest("rejected a health query.");
    }
    return;
  }

  if (url.pathname === PROJECT_PATH) {
    if (url.search) {
      throw invalidRequest("rejected a project query.");
    }
    return;
  }

  if (url.pathname === PERMISSION_PATH) {
    requireProjectQuery(url);
    return;
  }

  if (url.pathname === SESSION_PATH) {
    requireProjectQuery(url);
    return;
  }

  if (url.pathname === SESSION_STATUS_PATH) {
    requireProjectQuery(url);
    return;
  }

  if (url.pathname === PROVIDERS_PATH) {
    requireProjectQuery(url);
    return;
  }

  if (url.pathname === COMMANDS_PATH) {
    requireProjectQuery(url);
    return;
  }

  if (url.pathname === VCS_STATUS_PATH) {
    requireProjectQuery(url);
    return;
  }

  if (url.pathname === VCS_DIFF_PATH) {
    requireProjectQuery(url, ["mode", "context"]);

    const modes = url.searchParams.getAll("mode");
    if (
      modes.length !== 1 ||
      !["git", "branch"].includes(modes[0])
    ) {
      throw invalidRequest("requires a valid diff mode.");
    }

    if (url.searchParams.has("context")) {
      requireIntegerQuery(url, "context", 0, 20);
    }
    return;
  }

  const match = SESSION_ITEM_PATH.exec(url.pathname);
  if (match) {
    if (match[2] !== "message") {
      throw invalidRequest("rejected the request path.");
    }

    requireProjectQuery(url, ["limit"]);

    if (url.searchParams.has("limit")) {
      requireIntegerQuery(url, "limit", 1, 200);
    }
    return;
  }

  throw invalidRequest("rejected the request path.");
}

async function validateMutationRequest(request, url, method) {
  requireProjectQuery(url);

  if (method === "DELETE") {
    if (SESSION_RESOURCE_PATH.test(url.pathname)) {
      return {};
    }

    throw invalidRequest("rejected the request path.");
  }

  if (method === "PATCH") {
    const sessionMatch = SESSION_RESOURCE_PATH.exec(url.pathname);
    if (!sessionMatch) {
      throw invalidRequest("rejected the request path.");
    }

    const data = await requestBody(request);
    validateSessionUpdateBody(data);
    return { data };
  }

  const permissionMatch = PERMISSION_REPLY_PATH.exec(url.pathname);
  if (permissionMatch) {
    const data = await requestBody(request);
    validatePermissionReplyBody(data);
    return { data };
  }

  if (url.pathname === SESSION_PATH) {
    const data = await requestBody(request);
    validateCreateBody(data);
    return { data };
  }

  const match = SESSION_ITEM_PATH.exec(url.pathname);
  if (!match) {
    throw invalidRequest("rejected the request path.");
  }

  const action = match[2];

  if (action === "prompt_async") {
    const data = await requestBody(request);
    validatePromptBody(data);
    return { data };
  }

  if (action === "command") {
    const data = await requestBody(request);
    validateCommandBody(data);
    return { data };
  }

  if (action === "abort") {
    await requestBody(request, { allowEmpty: true });
    return {};
  }

  throw invalidRequest("rejected the request path.");
}

async function validateRequest(request) {
  const method = request.method.toUpperCase();
  const url = new URL(request.url);

  if (
    url.origin !== NATIVE_OPENCODE_ORIGIN ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw invalidRequest(
      "only allows the exact loopback origin.",
    );
  }

  if (method === "GET") {
    validateReadRequest(url);
    return;
  }

  if (method === "POST" || method === "PATCH" || method === "DELETE") {
    return validateMutationRequest(request, url, method);
  }

  throw invalidRequest("rejected the request method.");
}

function nativeRequestOptions(url, method, headers, data) {
  const options = {
    url: url.href,
    method,
    headers,
    responseType: "text",
    connectTimeout: 10000,
    readTimeout: 30000,
    disableRedirects: true,
  };

  if (data !== undefined) {
    options.data = data;
  }

  return options;
}

async function requestWithAbort(http, options, signal) {
  if (signal?.aborted) throw abortError();

  const pending = http.request(options);
  if (!signal) return pending;

  let abortHandler;
  const aborted = new Promise((_, reject) => {
    abortHandler = () => reject(abortError());
    signal.addEventListener("abort", abortHandler, { once: true });
  });

  try {
    return await Promise.race([pending, aborted]);
  } finally {
    signal.removeEventListener("abort", abortHandler);
  }
}

export function createNativeFetch(http = CapacitorHttp) {
  if (typeof http?.request !== "function") {
    throw new TypeError("Native OpenCode transport is unavailable.");
  }

  return async function nativeFetch(input, init) {
    const request = new Request(input, init);
    const method = request.method.toUpperCase();
    const target = await validateRequest(request);
    const url = new URL(request.url);

    const headers = {};
    request.headers.forEach((value, name) => {
      headers[name] = value;
    });

    const data = target?.data;

    let response;
    try {
      response = await requestWithAbort(
        http,
        nativeRequestOptions(url, method, headers, data),
        request.signal,
      );
    } catch (error) {
      if (error?.name === "AbortError") throw error;

      if (isTimeoutFailure(error)) {
        throw new OpenCodeConnectionError(
          CONNECTION_ERROR_KINDS.TIMEOUT,
          "The OpenCode server did not respond in time.",
          { cause: error },
        );
      }

      throw new TypeError("Native OpenCode transport request failed.", {
        cause: error,
      });
    }

    if (!response || typeof response !== "object") {
      throw new TypeError("Native OpenCode transport received no response.");
    }

    const status = response.status;
    if (
      typeof status !== "number" ||
      !Number.isInteger(status) ||
      status < 200 ||
      status > 599 ||
      (status >= 300 && status < 400)
    ) {
      throw new TypeError("Native OpenCode transport rejected the response.");
    }

    const contentLength = declaredContentLength(response.headers);
    if (contentLength != null && contentLength > MAX_RESPONSE_BYTES) {
      throw new TypeError("Native OpenCode transport response is too large.");
    }

    const body = [204, 205].includes(status)
      ? null
      : nativeResponseBody(response.data);

    if (
      body != null &&
      new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES
    ) {
      throw new TypeError("Native OpenCode transport response is too large.");
    }

    return new Response(body, {
      status,
      headers: nativeResponseHeaders(response.headers),
    });
  };
}

export const nativeFetch = Capacitor.isNativePlatform()
  ? createNativeFetch()
  : null;
