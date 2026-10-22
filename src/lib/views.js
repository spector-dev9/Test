export const VIEW_IDS = Object.freeze([
  "chat",
  "files",
  "changes",
  "terminal",
  "preview",
  "context",
  "sessions",
  "models",
  "settings",
  "appearance",
]);

export const PRIMARY_VIEW_IDS = Object.freeze([
  "chat",
  "files",
  "changes",
  "terminal",
  "preview",
  "settings",
]);

export const PRIMARY_NAV = Object.freeze([
  { id: "chat", label: "Chat", icon: "⌘" },
  { id: "files", label: "Files", icon: "◇" },
  { id: "changes", label: "Changes", icon: "≡" },
  { id: "terminal", label: "Terminal", icon: "›_" },
  { id: "preview", label: "Preview", icon: "◳" },
  { id: "settings", label: "Settings", icon: "⚙" },
]);

export function isValidViewId(value) {
  return typeof value === "string" && VIEW_IDS.includes(value);
}
