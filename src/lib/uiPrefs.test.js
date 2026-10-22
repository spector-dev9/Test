import assert from "node:assert/strict";
import test from "node:test";
import {
  UI_FONT_FAMILIES,
  UI_PREF_DEFAULTS,
  UI_THEMES,
  applyUiPrefs,
  fontFamilyStack,
  normalizeUiPrefs,
  readUiPrefs,
  writeUiPrefs,
} from "./uiPrefs.js";

function memoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    dump: () => Object.fromEntries(store),
  };
}

function fakeRoot() {
  const props = {};
  return {
    dataset: {},
    props,
    style: {
      setProperty(key, value) {
        props[key] = value;
      },
      removeProperty(key) {
        delete props[key];
      },
    },
  };
}

test("normalizes defaults for missing or invalid input", () => {
  assert.deepEqual(normalizeUiPrefs(undefined), UI_PREF_DEFAULTS);
  assert.deepEqual(normalizeUiPrefs(null), UI_PREF_DEFAULTS);
  assert.deepEqual(normalizeUiPrefs("nope"), UI_PREF_DEFAULTS);
  assert.deepEqual(normalizeUiPrefs({}), UI_PREF_DEFAULTS);
});

test("clamps and snaps out-of-range values", () => {
  const normalized = normalizeUiPrefs({
    reducedMotion: "yes",
    fontScale: 300,
    terminalFontSize: 99,
    editorFontSize: -5,
  });

  assert.equal(normalized.reducedMotion, false, "only booleans enable motion");
  assert.equal(normalized.fontScale, 150);
  assert.equal(normalized.terminalFontSize, 16);
  assert.equal(normalized.editorFontSize, 10);

  assert.equal(normalizeUiPrefs({ fontScale: 90 }).fontScale, 90);
  assert.equal(normalizeUiPrefs({ fontScale: 107 }).fontScale, 110);
  assert.equal(normalizeUiPrefs({ fontScale: "120" }).fontScale, 120);
  assert.equal(normalizeUiPrefs({ fontScale: "abc" }).fontScale, 100);
  assert.equal(
    normalizeUiPrefs({ reducedMotion: 1 }).reducedMotion,
    false,
  );
  assert.equal(
    normalizeUiPrefs({ reducedMotion: true }).reducedMotion,
    true,
  );
});

test("round-trips through storage and survives corrupt data", () => {
  const storage = memoryStorage();

  writeUiPrefs(
    { reducedMotion: true, fontScale: 130, terminalFontSize: 15 },
    storage,
  );

  assert.deepEqual(readUiPrefs(storage), {
    reducedMotion: true,
    fontScale: 130,
    terminalFontSize: 15,
    editorFontSize: UI_PREF_DEFAULTS.editorFontSize,
    theme: UI_PREF_DEFAULTS.theme,
    fontFamily: UI_PREF_DEFAULTS.fontFamily,
  });

  assert.deepEqual(readUiPrefs(memoryStorage()), UI_PREF_DEFAULTS);

  const corrupt = memoryStorage({ "opencode-mobile.ui-prefs": "{oops" });
  assert.deepEqual(readUiPrefs(corrupt), UI_PREF_DEFAULTS);
});

test("returns defaults when storage access throws", () => {
  const broken = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };

  assert.deepEqual(readUiPrefs(broken), UI_PREF_DEFAULTS);
  const stored = writeUiPrefs({ fontScale: 140 }, broken);
  assert.equal(stored.fontScale, 140);
});

test("applies preferences to the document root", () => {
  const root = fakeRoot();

  const applied = applyUiPrefs(
    {
      reducedMotion: true,
      fontScale: 120,
      terminalFontSize: 15,
      editorFontSize: 12,
    },
    root,
  );

  assert.deepEqual(applied, {
    reducedMotion: true,
    fontScale: 120,
    terminalFontSize: 15,
    editorFontSize: 12,
    theme: UI_PREF_DEFAULTS.theme,
    fontFamily: UI_PREF_DEFAULTS.fontFamily,
  });
  assert.equal(root.dataset.reduceMotion, "true");
  assert.equal(root.props["--ui-font-scale"], "1.2");
  assert.equal(root.props["--terminal-font-size"], "15px");
  assert.equal(root.props["--editor-font-size"], "12px");
  assert.equal(root.dataset.theme, "violet");
  assert.equal(root.dataset.fontFamily, "system");
  assert.equal(
    root.props["--ui-font-family"],
    fontFamilyStack("system"),
  );

  applyUiPrefs(UI_PREF_DEFAULTS, root);
  assert.equal(root.dataset.reduceMotion, "false");
  assert.equal(root.props["--ui-font-scale"], "1");

  const detached = applyUiPrefs(UI_PREF_DEFAULTS, null);
  assert.deepEqual(detached, UI_PREF_DEFAULTS);
});

test("keeps only supported themes and font families", () => {
  assert.equal(normalizeUiPrefs({ theme: "emerald" }).theme, "emerald");
  assert.equal(normalizeUiPrefs({ theme: "neon" }).theme, "violet");
  assert.equal(normalizeUiPrefs({ theme: 7 }).theme, "violet");
  assert.equal(normalizeUiPrefs({ fontFamily: "monospace" }).fontFamily, "monospace");
  assert.equal(normalizeUiPrefs({ fontFamily: "comic" }).fontFamily, "system");
  assert.ok(UI_THEMES.includes("violet"));
  assert.ok(UI_FONT_FAMILIES.includes("system"));
});

test("persists theme and font family choices", () => {
  const storage = memoryStorage();

  writeUiPrefs(
    { ...UI_PREF_DEFAULTS, theme: "amber", fontFamily: "monospace" },
    storage,
  );

  const stored = readUiPrefs(storage);
  assert.equal(stored.theme, "amber");
  assert.equal(stored.fontFamily, "monospace");
});
