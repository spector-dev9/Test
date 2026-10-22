export async function copyText(text) {
  if (text == null) throw new Error("Nothing to copy.");
  const value = String(text);
  if (!value.trim()) throw new Error("Nothing to copy.");

  let clipboardFailure = null;

  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch (failure) {
      clipboardFailure = failure;
    }
  }

  if (typeof document === "undefined" || !document.body) {
    throw clipboardFailure ?? new Error("Clipboard access is unavailable.");
  }

  const fallback = document.createElement("textarea");
  fallback.value = value;
  fallback.setAttribute("readonly", "");
  fallback.style.position = "fixed";
  fallback.style.left = "-9999px";
  fallback.style.top = "-9999px";
  document.body.appendChild(fallback);

  try {
    fallback.focus();
    fallback.select();
    fallback.setSelectionRange(0, value.length);
    if (!document.execCommand("copy")) {
      throw clipboardFailure ?? new Error("The clipboard rejected the copy.");
    }
  } finally {
    document.body.removeChild(fallback);
  }
}
