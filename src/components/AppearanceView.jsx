import {
  UI_FONT_FAMILIES,
  UI_PREF_LIMITS,
  UI_THEMES,
  fontFamilyStack,
  normalizeUiPrefs,
} from "../lib/uiPrefs";

const THEME_LABELS = {
  violet: "Violet",
  emerald: "Emerald",
  amber: "Amber",
  rose: "Rose",
};

const FONT_LABELS = {
  system: "System",
  rounded: "Rounded",
  monospace: "Monospace",
  serif: "Serif",
};

export function AppearanceView({ uiPrefs, onChangeUiPref }) {
  const prefs = normalizeUiPrefs(uiPrefs);

  return (
    <section className="page-view appearance-view" aria-labelledby="appearance-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow">WORKSPACE</p>
          <h1 id="appearance-heading">Theme &amp; Appearance</h1>
          <p className="subtitle">
            Accent, typography, and motion for this device. Changes apply
            immediately to chat, tool cards, the terminal, the editor, and
            dialogs.
          </p>
        </div>
      </div>

      <div className="settings-stack">
        <section className="panel settings-card">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">ACCENT</span>
              <h2>Color theme</h2>
            </div>
          </div>

          <div className="theme-grid" role="group" aria-label="Color theme">
            {UI_THEMES.map((theme) => (
              <button
                key={theme}
                type="button"
                className={`theme-option theme-${theme}${prefs.theme === theme ? " active" : ""}`}
                aria-pressed={prefs.theme === theme}
                onClick={() => onChangeUiPref("theme", theme)}
              >
                <span className="theme-swatch" aria-hidden="true" />
                <span className="theme-label">
                  {THEME_LABELS[theme] ?? theme}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel settings-card">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">TYPOGRAPHY</span>
              <h2>Font and text size</h2>
            </div>
          </div>

          <div className="appearance-list">
            <label className="appearance-row appearance-row-select">
              <span className="appearance-copy">
                <strong>Interface font</strong>
                <small>Applies to the whole interface.</small>
              </span>
              <select
                className="appearance-select"
                value={prefs.fontFamily}
                onChange={(event) =>
                  onChangeUiPref("fontFamily", event.target.value)
                }
                aria-label="Interface font"
              >
                {UI_FONT_FAMILIES.map((family) => (
                  <option key={family} value={family}>
                    {FONT_LABELS[family] ?? family}
                  </option>
                ))}
              </select>
            </label>

            <label className="appearance-row">
              <span className="appearance-copy">
                <strong>Text size</strong>
                <small>Scales the whole interface.</small>
              </span>
              <input
                type="range"
                min={UI_PREF_LIMITS.fontScale.min}
                max={UI_PREF_LIMITS.fontScale.max}
                step={UI_PREF_LIMITS.fontScale.step}
                value={prefs.fontScale}
                onChange={(event) =>
                  onChangeUiPref("fontScale", Number(event.target.value))
                }
                aria-label="Interface text size"
              />
              <output className="appearance-value">{prefs.fontScale}%</output>
            </label>

            <label className="appearance-row">
              <span className="appearance-copy">
                <strong>Terminal font</strong>
                <small>Text size in the interactive shell.</small>
              </span>
              <input
                type="range"
                min={UI_PREF_LIMITS.terminalFontSize.min}
                max={UI_PREF_LIMITS.terminalFontSize.max}
                step={UI_PREF_LIMITS.terminalFontSize.step}
                value={prefs.terminalFontSize}
                onChange={(event) =>
                  onChangeUiPref(
                    "terminalFontSize",
                    Number(event.target.value),
                  )
                }
                aria-label="Terminal font size"
              />
              <output className="appearance-value">
                {prefs.terminalFontSize}px
              </output>
            </label>

            <label className="appearance-row">
              <span className="appearance-copy">
                <strong>Editor font</strong>
                <small>Text size in the file editor and preview.</small>
              </span>
              <input
                type="range"
                min={UI_PREF_LIMITS.editorFontSize.min}
                max={UI_PREF_LIMITS.editorFontSize.max}
                step={UI_PREF_LIMITS.editorFontSize.step}
                value={prefs.editorFontSize}
                onChange={(event) =>
                  onChangeUiPref(
                    "editorFontSize",
                    Number(event.target.value),
                  )
                }
                aria-label="Editor font size"
              />
              <output className="appearance-value">
                {prefs.editorFontSize}px
              </output>
            </label>
          </div>

          <p className="panel-note">
            Interface font stack: <code>{fontFamilyStack(prefs.fontFamily)}</code>
          </p>
        </section>

        <section className="panel settings-card">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">ACCESSIBILITY</span>
              <h2>Motion</h2>
            </div>
          </div>

          <div className="appearance-list">
            <label className="appearance-row appearance-row-toggle">
              <span className="appearance-copy">
                <strong>Reduce motion</strong>
                <small>Cuts animations and pulsing effects across the app.</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={prefs.reducedMotion}
                onChange={(event) =>
                  onChangeUiPref("reducedMotion", event.target.checked)
                }
              />
            </label>
          </div>

          <p className="panel-note">
            Preferences are stored on this device only and are applied live
            without restarting the session.
          </p>
        </section>
      </div>
    </section>
  );
}
