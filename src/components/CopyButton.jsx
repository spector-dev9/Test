import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "../lib/clipboard";

const RESET_MS = 1800;

export function CopyButton({
  text,
  label = "Copy",
  title,
  disabled = false,
  className = "",
}) {
  const [state, setState] = useState("idle");
  const timerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (disabled || !text || typeof text !== "string") return;

    if (timerRef.current) clearTimeout(timerRef.current);

    try {
      await copyText(text);
      setState("copied");
    } catch {
      setState("failed");
    }

    timerRef.current = setTimeout(() => setState("idle"), RESET_MS);
  }, [text, disabled]);

  const copied = state === "copied";
  const failed = state === "failed";
  const accessibleLabel = failed
    ? "Copy failed"
    : copied
      ? "Copied"
      : title ?? label;

  return (
    <button
      type="button"
      className={`copy-button ${className}${copied ? " copied" : ""}${
        failed ? " failed" : ""
      }`.trim()}
      disabled={disabled || !text?.trim()}
      onClick={handleCopy}
      title={accessibleLabel}
      aria-label={accessibleLabel}
      aria-live="polite"
    >
      {failed ? "Copy failed" : copied ? "Copied" : label}
    </button>
  );
}
