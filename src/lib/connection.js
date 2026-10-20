export const DEFAULT_OPENCODE_URL = "http://127.0.0.1:4097";
export const NATIVE_OPENCODE_ORIGIN = DEFAULT_OPENCODE_URL;
export const BROWSER_REQUEST_TIMEOUT_MS = 15000;

export const CONNECTION_ERROR_KINDS = Object.freeze({
  NETWORK: "network",
  TIMEOUT: "timeout",
  HTTP: "http",
  UNHEALTHY: "unhealthy",
  INVALID: "invalid",
  CONFIGURATION: "configuration",
  ABORTED: "aborted",
  UNKNOWN: "unknown",
});

export class OpenCodeConnectionError extends Error {
  constructor(kind, message, { status, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "OpenCodeConnectionError";
    this.kind = kind;

    if (status !== undefined) {
      this.status = status;
    }
  }
}

export function connectionFailure(error, fallback) {
  if (error instanceof OpenCodeConnectionError) {
    return {
      kind: error.kind,
      message: error.message,
      status: error.status,
    };
  }

  return {
    kind: CONNECTION_ERROR_KINDS.UNKNOWN,
    message: fallback,
    status: undefined,
  };
}

export function validateOpenCodeBaseUrl(baseUrl, { native = false } = {}) {
  let url;

  try {
    url = new URL(baseUrl);
  } catch {
    return "VITE_OPENCODE_URL must be a valid HTTP(S) URL.";
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return "VITE_OPENCODE_URL must use HTTP or HTTPS.";
  }

  if (url.username || url.password) {
    return "VITE_OPENCODE_URL must not contain credentials.";
  }

  if (!native) return null;

  if (
    url.origin !== NATIVE_OPENCODE_ORIGIN ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    return (
      `Native builds can only connect to ${NATIVE_OPENCODE_ORIGIN}. ` +
      "Remove VITE_OPENCODE_URL or rebuild with the default URL."
    );
  }

  return null;
}

export async function runWithTimeout(
  task,
  { signal, timeoutMs = BROWSER_REQUEST_TIMEOUT_MS } = {},
) {
  if (signal?.aborted) {
    throw new OpenCodeConnectionError(
      CONNECTION_ERROR_KINDS.ABORTED,
      "The OpenCode request was cancelled.",
    );
  }

  const controller = new AbortController();
  let timedOut = false;
  let abortHandler;
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(
        new OpenCodeConnectionError(
          CONNECTION_ERROR_KINDS.TIMEOUT,
          "The OpenCode server did not respond in time.",
        ),
      );
    }, timeoutMs);
  });

  let abort;
  if (signal) {
    abort = new Promise((_, reject) => {
      abortHandler = () => {
        controller.abort();
        reject(
          new OpenCodeConnectionError(
            CONNECTION_ERROR_KINDS.ABORTED,
            "The OpenCode request was cancelled.",
          ),
        );
      };
      signal.addEventListener("abort", abortHandler, { once: true });
    });
  }

  const request = Promise.resolve().then(() => task(controller.signal));
  const pending = abort ? [request, timeout, abort] : [request, timeout];

  try {
    return await Promise.race(pending);
  } catch (error) {
    if (error instanceof OpenCodeConnectionError) {
      throw error;
    }

    if (timedOut) {
      throw new OpenCodeConnectionError(
        CONNECTION_ERROR_KINDS.TIMEOUT,
        "The OpenCode server did not respond in time.",
        { cause: error },
      );
    }

    if (signal?.aborted) {
      throw new OpenCodeConnectionError(
        CONNECTION_ERROR_KINDS.ABORTED,
        "The OpenCode request was cancelled.",
        { cause: error },
      );
    }

    throw error;
  } finally {
    clearTimeout(timer);

    if (signal && abortHandler) {
      signal.removeEventListener("abort", abortHandler);
    }
  }
}
