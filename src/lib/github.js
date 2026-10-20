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
