export async function copyText(text) {
  if (text == null) throw new Error("Nothing to copy.");
  const value = String(text);
  if (!value.trim()) throw new Error("Nothing to copy.");

  if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    await navigator.clipboard.writeText(value);
    return;
  }

  const fallback = document.createElement("textarea");
  fallback.value = value;
  fallback.setAttribute("readonly", "");
  fallback.style.position = "fixed";
  fallback.style.left = "-9999px";
  fallback.style.top = "-9999px";
  document.body.appendChild(fallback);
  try {
    fallback.select();
    document.execCommand("copy");
  } finally {
    document.body.removeChild(fallback);
  }
}
