const NOT_FOUND_PATTERN = /(?:^|\n)[^\n:]*:\s*([^\s:]+):\s*not found/i;

/**
 * Detect a command that failed only because of letter case.
 *
 * The shell reports "sh: Apk: not found" for `Apk`, which is a very common
 * keyboard slip on mobile. Returning the lower-case form lets the UI explain
 * the mistake instead of leaving the user with a bare error.
 */
export function caseSuggestion(output) {
  if (typeof output !== "string" || !output.trim()) return null;

  const match = NOT_FOUND_PATTERN.exec(output);
  if (!match) return null;

  const word = match[1];

  if (!word || word === word.toLowerCase()) return null;
  if (!/^[A-Za-z][A-Za-z0-9._+-]*$/.test(word)) return null;

  return word.toLowerCase();
}

export function commandHint(command, output) {
  const suggestion = caseSuggestion(output);

  if (suggestion) {
    return `Shell commands are case-sensitive. Try: ${suggestion}`;
  }

  if (/[^\n:]*:\s*not found/i.test(output ?? "")) {
    return "That command is not available in this environment. Alpine uses apk, not apt or pkg.";
  }

  if (
    /unable to select packages|no such package|temporary error/i.test(
      output ?? "",
    )
  ) {
    return "The package index may be stale or unreachable. Run apk update, then try again.";
  }

  return null;
}

export function commandOutcome(result) {
  const exitCode = Number.isInteger(result?.exitCode) ? result.exitCode : 0;
  const timedOut = Boolean(result?.timedOut) || exitCode === 124;
  const output = typeof result?.output === "string" ? result.output : "";
  const durationMs = Number.isFinite(Number(result?.durationMs))
    ? Math.max(0, Number(result.durationMs))
    : null;
  const ok = !timedOut
    && (typeof result?.ok === "boolean" ? result.ok : exitCode === 0);
  return {
    ok,
    exitCode,
    timedOut,
    output,
    durationMs,
    label: timedOut
      ? "Timed out"
      : ok && exitCode !== 0
        ? `Exit ${exitCode} (verified)`
        : `Exit ${exitCode}`,
  };
}
