export const UI_PREFS_STORAGE_KEY = "opencode-mobile.ui-prefs";

export const UI_THEMES = Object.freeze(["violet", "emerald", "amber", "rose"]);

export const UI_FONT_FAMILIES = Object.freeze([
  "system",
  "rounded",
  "monospace",
  "serif",
]);

export const UI_PREF_DEFAULTS = Object.freeze({
  reducedMotion: false,
  fontScale: 100,
  terminalFontSize: 13,
  editorFontSize: 11,
  theme: "violet",
  fontFamily: "system",
});

export const UI_PREF_LIMITS = Object.freeze({
  fontScale: { min: 90, max: 150, step: 10 },
  terminalFontSize: { min: 11, max: 16, step: 1 },
  editorFontSize: { min: 10, max: 16, step: 1 },
});

function clampInt(value, min, max, fallback) {
  const parsed =
    typeof value === "number"
      ? Math.round(value)
      : Number.parseInt(String(value), 10);

  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function snapScale(value) {
  const clamped = clampInt(
    value,
    UI_PREF_LIMITS.fontScale.min,
    UI_PREF_LIMITS.fontScale.max,
    UI_PREF_DEFAULTS.fontScale,
  );
  return Math.round(clamped / UI_PREF_LIMITS.fontScale.step) *
    UI_PREF_LIMITS.fontScale.step;
}

function normalizeChoice(value, allowed, fallback) {
  return typeof value === "string" && allowed.includes(value)
    ? value
    : fallback;
}

export function normalizeUiPrefs(raw) {
  const source = raw && typeof raw === "object" ? raw : {};

  return {
    reducedMotion: source.reducedMotion === true,
    theme: normalizeChoice(
      source.theme,
      UI_THEMES,
      UI_PREF_DEFAULTS.theme,
    ),
    fontFamily: normalizeChoice(
      source.fontFamily,
      UI_FONT_FAMILIES,
      UI_PREF_DEFAULTS.fontFamily,
    ),
    fontScale: snapScale(source.fontScale),
    terminalFontSize: clampInt(
      source.terminalFontSize,
      UI_PREF_LIMITS.terminalFontSize.min,
      UI_PREF_LIMITS.terminalFontSize.max,
      UI_PREF_DEFAULTS.terminalFontSize,
    ),
    editorFontSize: clampInt(
      source.editorFontSize,
      UI_PREF_LIMITS.editorFontSize.min,
      UI_PREF_LIMITS.editorFontSize.max,
      UI_PREF_DEFAULTS.editorFontSize,
    ),
  };
}

function defaultStorage() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export const UI_FONT_STACKS = Object.freeze({
  system:
    'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  rounded:
    '"SF Pro Rounded", system-ui, "Roboto", "Segoe UI", sans-serif',
  monospace:
    'ui-monospace, SFMono-Regular, Menlo, "Cascadia Mono", "Roboto Mono", monospace',
  serif: 'Georgia, "Noto Serif", "Times New Roman", serif',
});

export function fontFamilyStack(family) {
  const key = normalizeChoice(
    family,
    UI_FONT_FAMILIES,
    UI_PREF_DEFAULTS.fontFamily,
  );

  return UI_FONT_STACKS[key];
}

function defaultRoot() {
  try {
    return typeof document === "undefined" ? null : document.documentElement;
  } catch {
    return null;
  }
}

export function readUiPrefs(storage = defaultStorage()) {
  if (!storage) return { ...UI_PREF_DEFAULTS };

  try {
    const raw = storage.getItem(UI_PREFS_STORAGE_KEY);
    if (!raw) return { ...UI_PREF_DEFAULTS };
    return normalizeUiPrefs(JSON.parse(raw));
  } catch {
    return { ...UI_PREF_DEFAULTS };
  }
}

export function writeUiPrefs(prefs, storage = defaultStorage()) {
  const normalized = normalizeUiPrefs(prefs);

  if (storage) {
    try {
      storage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // Preference persistence is best effort.
    }
  }

  return normalized;
}

export function applyUiPrefs(prefs, root = defaultRoot()) {
  const normalized = normalizeUiPrefs(prefs);

  if (root) {
    root.dataset.reduceMotion = normalized.reducedMotion ? "true" : "false";
    root.dataset.theme = normalized.theme;
    root.dataset.fontFamily = normalized.fontFamily;
    root.style.setProperty(
      "--ui-font-family",
      fontFamilyStack(normalized.fontFamily),
    );
    root.style.setProperty(
      "--ui-font-scale",
      String(normalized.fontScale / 100),
    );
    root.style.setProperty(
      "--terminal-font-size",
      `${normalized.terminalFontSize}px`,
    );
    root.style.setProperty(
      "--editor-font-size",
      `${normalized.editorFontSize}px`,
    );
  }

  return normalized;
}
