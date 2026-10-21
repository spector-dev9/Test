import { useCallback, useState } from "react";
import { copyText } from "../lib/clipboard";

export function CopyButton({
  text,
  label = "Copy",
  title,
  disabled = false,
  className = "",
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (disabled || !text || typeof text !== "string") return;
    try {
      await copyText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, [text, disabled]);

  return (
    <button
      type="button"
      className={`copy-button ${className}`.trim()}
      disabled={disabled || !text?.trim()}
      onClick={handleCopy}
      title={title ?? (copied ? "Copied" : label)}
      aria-label={title ?? label}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
