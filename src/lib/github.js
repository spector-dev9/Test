import { Capacitor, registerPlugin } from "@capacitor/core";
import { normalizeProjectDirectory } from "./project.js";

const NativeGitHub = Capacitor.isNativePlatform()
  ? registerPlugin("GitHub")
  : null;

export function isGitHubToolsSupported() {
  return Boolean(NativeGitHub);
}

export function parseRepositoryUrl(value, token) {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, error: "Enter a GitHub repository URL." };
  }

  let url;

  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false, error: "Enter a valid repository URL." };
  }

  if (url.protocol !== "https:" || !url.hostname) {
    return { ok: false, error: "Repository URLs must use HTTPS." };
  }

  if (url.username || url.password || url.search || url.hash) {
    return { ok: false, error: "Repository URLs cannot include credentials or query parameters." };
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    return { ok: false, error: "Use a URL like https://github.com/owner/repository." };
  }

  const owner = parts[parts.length - 2];
  const repository = parts[parts.length - 1].replace(/\.git$/i, "");

  if (
    !/^[A-Za-z0-9_.-]+$/.test(owner) ||
    !/^[A-Za-z0-9_.-]+$/.test(repository) ||
    repository === "." ||
    repository === ".." ||
    owner === "." ||
    owner === ".."
  ) {
    return { ok: false, error: "The repository owner or name is invalid." };
  }

  if (token != null && (typeof token !== "string" || token.length > 500)) {
    return { ok: false, error: "The repository token is invalid." };
  }

  return {
    ok: true,
    url: url.toString(),
    owner,
    name: repository,
    label: `${owner}/${repository}`,
  };
}

export function joinWorkspacePath(directory, name) {
  const normalized = normalizeProjectDirectory(directory);
  if (!normalized || typeof name !== "string" || !name.trim()) return null;
  if (name.includes("/") || name.includes("\\")) return null;
  return `${normalized}/${name.trim()}`;
}

export async function copilotStatus() {
  if (!NativeGitHub) {
    throw new Error("GitHub tools are only available in the Android app.");
  }
  return NativeGitHub.copilotStatus();
}

export async function repositoryStatus(directory) {
  if (!NativeGitHub) {
    throw new Error("GitHub tools are only available in the Android app.");
  }
  return NativeGitHub.status({ directory });
}

export async function cloneRepository({ url, destination, token, branch }) {
  if (!NativeGitHub) {
    throw new Error("GitHub tools are only available in the Android app.");
  }
  return NativeGitHub.cloneRepository({
    url,
    destination,
    ...(token ? { token } : {}),
    ...(branch ? { branch } : {}),
  });
}

export async function commitAndPush({
  directory,
  message,
  token,
  name,
  email,
}) {
  if (!NativeGitHub) {
    throw new Error("GitHub tools are only available in the Android app.");
  }
  return NativeGitHub.commitAndPush({
    directory,
    message,
    token,
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
  });
}

export async function initRepository({ directory, branch, remote }) {
  if (!NativeGitHub) {
    throw new Error("GitHub tools are only available in the Android app.");
  }
  return NativeGitHub.initRepository({
    directory,
    ...(branch ? { branch } : {}),
    ...(remote ? { remote } : {}),
  });
}

export async function fetchRepository({ directory, token }) {
  if (!NativeGitHub) {
    throw new Error("GitHub tools are only available in the Android app.");
  }
  return NativeGitHub.fetchRepository({
    directory,
    ...(token ? { token } : {}),
  });
}

export async function pullRepository({ directory, token }) {
  if (!NativeGitHub) {
    throw new Error("GitHub tools are only available in the Android app.");
  }
  return NativeGitHub.pullRepository({
    directory,
    ...(token ? { token } : {}),
  });
}

export async function listBranches(directory) {
  if (!NativeGitHub) {
    throw new Error("GitHub tools are only available in the Android app.");
  }
  return NativeGitHub.listBranches({ directory });
}

export async function checkoutBranch({ directory, branch }) {
  if (!NativeGitHub) {
    throw new Error("GitHub tools are only available in the Android app.");
  }
  return NativeGitHub.checkoutBranch({ directory, branch });
}

const BRANCH_PATTERN = /^[A-Za-z0-9._/-]{1,200}$/;

export function isValidBranchName(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || !BRANCH_PATTERN.test(trimmed)) return false;
  return !trimmed.includes("..") && !trimmed.startsWith("/") && !trimmed.endsWith("/");
}

export function parseRemoteUrl(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";

  if (!trimmed) {
    return { ok: false, error: "Enter the HTTPS address of the repository." };
  }

  let url;

  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "Enter a valid HTTPS repository address." };
  }

  if (url.protocol !== "https:") {
    return { ok: false, error: "Repository addresses must use HTTPS." };
  }

  if (url.username || url.password || url.search || url.hash) {
    return {
      ok: false,
      error: "Repository addresses cannot include credentials or query parameters.",
    };
  }

  const parts = url.pathname.split("/").filter(Boolean);

  if (parts.length < 2) {
    return {
      ok: false,
      error: "Use an address like https://github.com/owner/repository.",
    };
  }

  return { ok: true, url: url.toString() };
}
