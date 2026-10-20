import { Capacitor, CapacitorHttp } from "@capacitor/core";
import {
  CONNECTION_ERROR_KINDS,
  NATIVE_OPENCODE_ORIGIN,
  OpenCodeConnectionError,
} from "./connection.js";
import { PROJECT_DIRECTORY } from "./project.js";

const HEALTH_PATH = "/global/health";
const SESSION_PATH = "/session";
const OMITTED_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
]);
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

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

function validateRequest(request) {
  const method = request.method.toUpperCase();
  if (method !== "GET") {
    throw new TypeError("Native OpenCode transport only allows GET requests.");
  }

  const url = new URL(request.url);

  if (
    url.origin !== NATIVE_OPENCODE_ORIGIN ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new TypeError(
      "Native OpenCode transport only allows the exact loopback origin.",
    );
  }

  if (url.pathname === HEALTH_PATH) {
    if (url.search) {
      throw new TypeError("Native OpenCode transport rejected a health query.");
    }
    return url;
  }

  if (url.pathname === SESSION_PATH) {
    const entries = [...url.searchParams.entries()];

    if (
      entries.length !== 1 ||
      entries[0][0] !== "directory" ||
      entries[0][1] !== PROJECT_DIRECTORY
    ) {
      throw new TypeError(
        "Native OpenCode transport requires the project session directory.",
      );
    }

    return url;
  }

  throw new TypeError("Native OpenCode transport rejected the request path.");
}

export function createNativeFetch(http = CapacitorHttp) {
  if (typeof http?.request !== "function") {
    throw new TypeError("Native OpenCode transport is unavailable.");
  }

  return async function nativeFetch(input, init) {
    const request = new Request(input, init);
    const method = request.method.toUpperCase();
    const url = validateRequest(request);

    const headers = {};
    request.headers.forEach((value, name) => {
      headers[name] = value;
    });

    let response;
    try {
      response = await http.request({
        url: url.href,
        method,
        headers,
        responseType: "text",
        connectTimeout: 10000,
        readTimeout: 30000,
        disableRedirects: true,
      });
    } catch (error) {
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
