import {
  PROJECT_DIRECTORY,
  normalizeProjectDirectory,
} from "./project.js";

const initialDirectories = [PROJECT_DIRECTORY];
let allowedDirectories = new Set(initialDirectories);

export function registerProjectDirectories(directories) {
  if (!Array.isArray(directories)) return;

  for (const value of directories) {
    const directory = normalizeProjectDirectory(value);
    if (directory) allowedDirectories.add(directory);
  }
}

export function isAllowedProjectDirectory(directory) {
  const normalized = normalizeProjectDirectory(directory);
  return Boolean(normalized && allowedDirectories.has(normalized));
}

export function resetProjectDirectoryScope() {
  allowedDirectories = new Set(initialDirectories);
}
