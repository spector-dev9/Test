export const UI_PREFS_STORAGE_KEY = "opencode-mobile.ui-prefs";

export const UI_PREF_DEFAULTS = Object.freeze({
  reducedMotion: false,
  fontScale: 100,
  terminalFontSize: 13,
  editorFontSize: 11,
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

export function normalizeUiPrefs(raw) {
  const source = raw && typeof raw === "object" ? raw : {};

  return {
    reducedMotion: source.reducedMotion === true,
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
