const PREVIEW_URL_STORAGE_KEY = "opencode-mobile.preview-url";
const PREVIEW_COMMAND_STORAGE_KEY = "opencode-mobile.preview-command";

export function parsePreviewUrl(input) {
  const trimmed = typeof input === "string" ? input.trim() : "";

  if (!trimmed) {
    return {
      ok: false,
      error: "Enter a URL like http://localhost:5173.",
    };
  }

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;

  let url;

  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: "That is not a valid URL." };
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return { ok: false, error: "Preview supports only http and https URLs." };
  }

  if (url.username || url.password) {
    return { ok: false, error: "URLs with credentials are not supported." };
  }

  return { ok: true, url: url.href };
}

function stripBrackets(hostname) {
  return hostname.replace(/^\[/, "").replace(/\]$/, "");
}

export function isLoopbackHost(hostname) {
  const host = stripBrackets(String(hostname ?? "")).toLowerCase();

  if (!host) return false;
  if (host === "localhost" || host === "::1" || host === "0.0.0.0") {
    return true;
  }
  if (host.endsWith(".localhost")) return true;
  return /^127(\.\d{1,3}){3}$/.test(host);
}

export function isPrivatePreviewHost(hostname) {
  if (isLoopbackHost(hostname)) return true;

  const host = stripBrackets(String(hostname ?? ""));

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);

  if (ipv4) {
    const first = Number(ipv4[1]);
    const second = Number(ipv4[2]);

    if (first > 255 || second > 255) return false;
    if (first === 10) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 192 && second === 168) return true;
    if (first === 169 && second === 254) return true;
    return false;
  }

  if (host.includes(":")) {
    const lower = host.toLowerCase();

    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (/^fe[89ab]/.test(lower)) return true;
    return false;
  }

  return false;
}

export function canEmbedPreview(parsedUrl) {
  try {
    const url = new URL(parsedUrl);
    return isPrivatePreviewHost(url.hostname);
  } catch {
    return false;
  }
}

export function readStoredPreviewUrl() {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(PREVIEW_URL_STORAGE_KEY);
    return typeof value === "string" && value.length <= 2000 ? value : null;
  } catch {
    return null;
  }
}

export function storePreviewUrl(url) {
  if (typeof window === "undefined") return;

  try {
    if (url) {
      window.localStorage.setItem(PREVIEW_URL_STORAGE_KEY, url);
    } else {
      window.localStorage.removeItem(PREVIEW_URL_STORAGE_KEY);
    }
  } catch {
    return;
  }
}

export function readStoredPreviewCommand() {
  if (typeof window === "undefined") return "";

  try {
    const value = window.localStorage.getItem(PREVIEW_COMMAND_STORAGE_KEY);
    return typeof value === "string" && value.length <= 500 ? value : "";
  } catch {
    return "";
  }
}

export function storePreviewCommand(command) {
  if (typeof window === "undefined") return;

  try {
    if (command) {
      window.localStorage.setItem(PREVIEW_COMMAND_STORAGE_KEY, command);
    } else {
      window.localStorage.removeItem(PREVIEW_COMMAND_STORAGE_KEY);
    }
  } catch {
    return;
  }
}
