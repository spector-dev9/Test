export const PROJECT_DIRECTORY =
  "/data/user/0/com.opencode.mobile/files/workspace";

export const PROJECT_STORAGE_KEY = "opencode-mobile.project-id";

export const FALLBACK_PROJECT = Object.freeze({
  id: "local-project",
  name: "Workspace",
  worktree: PROJECT_DIRECTORY,
});

export function normalizeProjectDirectory(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.length > 1024 ||
    /[\0\r\n]/.test(value)
  ) {
    return null;
  }

  const segments = value.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return null;
  }

  const normalized = `/${segments.filter(Boolean).join("/")}`;
  if (normalized === "/") return null;

  return normalized;
}

export function projectLabel(project) {
  if (typeof project?.name === "string" && project.name.trim()) {
    return project.name.trim();
  }

  const directory = normalizeProjectDirectory(project?.worktree);
  if (!directory) return "Project";

  const parts = directory.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "Project";
}

export function projectPathLabel(project) {
  return normalizeProjectDirectory(project?.worktree) ?? "Unknown directory";
}
