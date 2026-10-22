const MAX_DETAIL_CHARS = 200;

/**
 * A short, safe description of a failure.
 *
 * Imported sessions and agent output are untrusted, and a rendering failure
 * must never take down the app. The message is trimmed and capped so the
 * fallback panel always stays readable.
 */
export function errorDetail(error, fallback = "An unexpected error occurred.") {
  const message =
    typeof error?.message === "string" ? error.message.trim() : "";

  if (!message) return fallback;

  return message.slice(0, MAX_DETAIL_CHARS);
}

export function boundaryCopy(label, error) {
  return {
    title: `${label} could not be displayed`,
    detail: errorDetail(error, "An unexpected rendering error occurred."),
    note:
      "The rest of the app still works. Switch to another destination, or " +
      "retry this view. The conversation and your files are unchanged.",
  };
}

export function fatalCopy(error) {
  return {
    kicker: "APP ERROR",
    title: "OpenCode Mobile could not continue",
    detail: errorDetail(error),
    note:
      "Your workspace, sessions, and files are unchanged. Reload the app to " +
      "continue.",
  };
}
