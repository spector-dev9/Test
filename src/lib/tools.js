const TOOL_STATE = {
  completed: "done",
  error: "failed",
  failed: "failed",
  running: "running",
  pending: "pending",
};

const STATUS_LABELS = {
  completed: "Done",
  error: "Failed",
  failed: "Failed",
  running: "Running",
  pending: "Pending",
};

export function toolStateClass(status) {
  return TOOL_STATE[status] ?? "pending";
}

export function toolStatusLabel(status) {
  return STATUS_LABELS[status] ?? "Pending";
}

export function toolPreview(text, limit = 160) {
  if (typeof text !== "string") return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  const single = trimmed.replace(/\s+/g, " ");
  return single.length > limit ? `${single.slice(0, limit)}…` : single;
}

export function toolHasDetails(tool) {
  if (!tool || typeof tool !== "object") return false;
  return Boolean(tool.input || tool.output || tool.error || tool.title);
}
