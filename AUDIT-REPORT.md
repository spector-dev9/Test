# OpenCode Mobile — Engineering Audit & Improvement Report

Date: 2026-10-22
Repository: `spector-dev9/Test` · Package: `com.opencode.mobile`
Scope: premium dark Android client for a local OpenCode server (`http://127.0.0.1:4097`)

---

## 1. Baseline

| Check | Result |
| --- | --- |
| `npm run lint` | clean (no warnings) |
| `npm test` | 143 pass / 0 fail |
| `npm run build` | ok — 845 kB (226 kB gzip) |
| Java compile | verified against `android.jar` (platform 36) with stubbed Capacitor/OkHttp/commons-compress |
| Android SDK/NDK | **not installed** → no local APK build; CI is the build path |
| Device access | `run-as` denied, app process hidden from Termux `/proc` → no runtime/temperature measurement from this host |

Architecture confirmed during the audit:

- **Frontend** — React 19 + Vite SPA in `src/` (`App.jsx`, `components/`, `hooks/`, `lib/`), Capacitor 8 shell, `@opencode-ai/sdk` v2 against a loopback origin.
- **Native layer** — `android/app/src/main/java/com/opencode/mobile/`: `LocalServerManager` (runtime download, server process, watchdog, log capture), `LocalServerService` (foreground service + notification), `LinuxEnvironment` (Alpine rootfs + PRoot), `GitHubPlugin`/`GitRuntime` (bundled git), `PtySocketPlugin`, `StoragePlugin`.
- **Server lifecycle** — `LocalServerManager` is a process-wide singleton guarded by a lock; `ensureStarted()` no-ops when the child process is alive, so a second server cannot be started. The service is `START_STICKY` and re-arms the server on restart.
- **Runtime** — the pinned OpenCode release is downloaded on first launch, patched (musl loader paths) and executed from `nativeLibraryDir` (app-private `exec` is blocked on Android 10+). PRoot + `libtalloc` + `libandroid-shmem` are packaged as JNI libraries.

---

## 2. Confirmed findings and root causes

### 2.1 Build/Plan was never real
`ChatView` sent `agent: session?.agent` on every prompt, pinning the agent to whatever the session was created with. The server *does* expose real mode agents, verified live against OpenCode 1.19.3:

```
build:primary:visible, plan:primary:visible, explore:subagent:visible,
compaction:primary:hidden, summary:primary:hidden, title:primary:hidden
```

`session/prompt_async` accepts `agent` and records it on the message (`info.agent`), so mode is a server-side behaviour, not a UI flag.

### 2.2 PRoot could not see the project
`LinuxEnvironment.runLinuxCommand` ran with `builder.directory(rootfs)` and **no bind mounts**, so the Alpine shell was sealed inside the rootfs. The agent, the terminal and the Alpine shell were three different filesystems.

### 2.3 "GitHub connected" and "not a repository" were unrelated facts
- `copilotStatus()` reads OpenCode's `auth.json` → a Copilot **model** OAuth token.
- `repositoryStatus()` runs `git rev-parse --is-inside-work-tree` in the **workspace** folder.

Both were rendered under one "GITHUB" heading, so a signed-in Copilot account looked like a broken repository. There was also no way to initialize a repository, fetch, pull, list branches or switch branches.

### 2.4 Two session stores, no explanation
The app's server stores sessions in `files/home/.local/share/opencode`; a Termux server on `:4096` stores them in `~/.local/share/opencode`. The app is pinned to `:4097` by `validateOpenCodeBaseUrl` (native builds may only use the exact loopback origin), so sessions from the Termux server were never visible — correctly, but with no UI explanation and no migration path.

### 2.5 The bundled rootfs was never used
The APK ships `assets/linux/alpine-minirootfs.tar` (plain tar, 9 113 600 B), while the code only looked for `linux/alpine-minirootfs.tar.gz` and compared it against the gzip checksum. Every first run silently re-downloaded 9 MB.

### 2.6 Idle rendering waste
Each poll replaced the message array → `normalizeConversation` → new React tree → auto-scroll. Permissions, questions and todos were also assigned new array identities every tick, so *every* poll re-rendered the app even when nothing had changed.

### 2.7 Tool calls clipped
Tool parts rendered as a single-line flex row (`width: fit-content`), so long bash commands and output were truncated with no way to read them, and no copy action for input/output.

### 2.8 Log I/O
`LocalServerManager.pumpOutput` opened and closed a `FileOutputStream` for **every** log line.

---

## 3. Implemented changes

### 3.1 Chat, tool calls, readable output
- New `src/components/ToolCard.jsx` + `src/lib/tools.js`: compact card (tool name, one-line summary, state chip, running spinner) that expands to the full input, output and error, each with a copy button. Output is bounded to 6 KB with an explicit "truncated" marker.
- `normalizeConversation` now captures `summary`, `input`, `output`, `error` per tool part (`src/lib/workspace.js`).
- Prose keeps natural wrapping (`overflow-wrap: break-word`); code blocks keep `white-space: pre` with horizontal scroll so indentation survives.
- Old single-line tool rows replaced by the card; copy actions exist for messages, code blocks, tool input and tool output.

### 3.2 Real Build / Plan
- `src/lib/agentMode.js` — modes, persistence, `resolveAgentName()` (only ever returns a server-advertised **primary**, non-hidden agent; otherwise keeps the session agent), `availableAgentModes()`.
- `listAgents()` added to the API layer (`client.app.agents({ directory })`), normalized to `{ name, description, mode, hidden }`.
- `useAgents()` hook loads agents for the active project directory.
- Composer renders a Build/Plan segmented switch; it is disabled while sending/working/stopping, shows the active mode in the chat subtitle, persists in `localStorage`, and is sent as `agent` on **prompts and slash commands**. Switching modes never touches the conversation, model, project or session.

### 3.3 Fullscreen preview workspace
- Expand / Restore / Close controls; fullscreen is a real `position: fixed` overlay (`100dvh`, safe-area padding) with a body scroll lock.
- Android back exits fullscreen before navigating; navigating away from Preview restores it automatically.
- Preview URL, run-command, project and session survive all destination switches.

### 3.4 Composer, attachments, TODO workflow
- New `src/components/TodoPanel.jsx` + `src/lib/todos.js`: collapsible panel above the composer, active work first, "View all tasks" opens the existing full dialog. The header pill now toggles the panel.
- Latest control shows a new-message count, appears only when actually scrolled away from the bottom, and has a descriptive `aria-label`.
- Multiline prompts, attachments, slash commands, Ctrl/⌘+Enter, cancellation and keyboard-safe resizing are unchanged.

### 3.5 Navigation, Theme & Appearance, settings layout
- New **Theme & Appearance** destination (`src/components/AppearanceView.jsx`, hamburger nav): accent theme (violet default, emerald, amber, rose), interface font (system/rounded/monospace/serif), text size, terminal and editor size, reduced motion. Applied live via CSS variables and `data-theme` / `data-font-family` on `<html>`.
- Appearance rows re-laid out as a grid (`minmax(0,1fr) / slider / value`) so labels no longer squeeze beside sliders; narrow screens stack the slider under the label.
- Session **import/export moved from Settings to Sessions** (`src/components/SessionTransfer.jsx`); formats and behaviour unchanged.
- Top navigation de-crowds on narrow screens: inactive tabs collapse to their icon, the active tab keeps its label; every destination stays reachable and every tab now has `title` + `aria-label`.

### 3.6 Git workflows
New native operations in `GitHubPlugin.java` (bundled git, HTTPS-only remotes, dirty-tree guards, tokens never logged):

| Method | Behaviour |
| --- | --- |
| `initRepository` | `git init -b <branch>`, optional `origin` remote |
| `fetchRepository` | `git fetch --prune` (token injected only for HTTPS) |
| `pullRepository` | `git pull --ff-only`, refuses with uncommitted work |
| `listBranches` | `git branch --format=%(refname:short)` + current branch |
| `checkoutBranch` | `git checkout`, refuses with uncommitted work |

UI: fetch/pull buttons, branch switcher, "Start a repository here" form, and a clear separation between *Copilot models* (OAuth) and *repository access* (fine-grained token). Client-side validation helpers (`parseRemoteUrl`, `isValidBranchName`) fail fast.

### 3.7 Alpine + PRoot + terminal
- `runLinuxCommand(command, directory)` and `installPackage(package, directory)` now accept the project directory; the plugin binds it into the guest (`-b path:path`) and uses it as the working directory, so the agent, the interactive terminal and the Alpine shell share one filesystem.
- Verified with the shipped `libproot.so` on a fresh Alpine 3.20 rootfs: `pwd` → the workspace, `cat readme.txt` → host file, `apk add --no-cache jq` → `APKEXIT=0` (apk 2.14.4), files created in the guest appear on the host.
- The terminal's Alpine panel states where commands run.

### 3.8 Runtime, sessions, reliability, performance
- `LocalServerManager` writes logs through a single buffered writer (flush every 32 lines) instead of one file open per line.
- The runtime status exposes its session-store path; Settings explains that the app always talks to `127.0.0.1:4097` with an app-private store and that import/export is the supported way to move a conversation to another server (e.g. the Termux server on `:4096`).
- Conversation polling: 1.6 s visible / 5 s hidden; unchanged messages, permissions, questions and todos no longer trigger a re-render (signature + identity checks, `WeakMap`-cached).
- Project health polling drops to 60 s while the app is hidden.

---

## 4. Lint, test and production-build results

```
npm run lint   → clean
npm test       → 172 pass / 0 fail   (baseline was 143 pass / 0 fail)
npm run build  → ok, dist/assets/index-*.js 865.91 kB (231.30 kB gzip),
                 dist/assets/index-*.css 98.26 kB (19.79 kB gzip)
javac          → LinuxEnvironment, GitHubPlugin, GitRuntime, LocalServerManager
                 compile clean against platform-36 android.jar
```

No pre-existing failure was found; the only changed assertion is the tool object shape in `workspace.test.js`, updated deliberately because the tool model intentionally gained fields.

---

## 5. Tests added

| File | Coverage |
| --- | --- |
| `src/lib/agentMode.test.js` | mode normalization, persistence, broken storage, agent resolution, never selecting hidden/subagent agents |
| `src/lib/navigation.test.js` | back-action precedence (menu → gate → modal → fullscreen → view → draft → exit) and history fallback |
| `src/lib/tools.test.js` | tool state mapping, status labels, collapsed preview, expandability |
| `src/lib/todos.test.js` | task summary, ordering (active before finished), status icons |
| `src/lib/workspace.test.js` | tool input/output capture, oversized-output bounding, malformed-part fallback |
| `src/lib/uiPrefs.test.js` | theme and font-family normalization, persistence, application to the document root |
| `src/lib/github.test.js` | branch-name and remote-URL validation |
| `src/lib/opencode.test.js` | `listAgents` normalization and the `agents` request shape |

---

## 6. Remaining defects, limitations, device-verification needed

1. **No APK was built here** — no Android SDK/NDK on this host. The Gradle/Capacitor build, the new native Git methods and the PRoot workspace binding must be exercised on a device or in CI before release.
2. **UI-level verification pending** for: fullscreen preview, the Build/Plan switch, expandable tool cards, the TODO panel, the Theme & Appearance screen, and the new Git controls.
3. `apk` inside the guest needs `apk update` before upgrades; `apt`/`pkg` are Android/Termux commands and are **not** available in Alpine.
4. Android SELinux denies hard links in app-private storage, so PRoot runs with `--link2symlink` and the rootfs extractor copies files that it cannot hard-link.
5. The Termux server on `:4096` and the app server on `:4097` keep separate session stores by design; sessions are moved explicitly via import/export rather than merged.
6. The OpenCode server process and its SQLite store run continuously in a foreground service — the dominant source of device heat.

## 7. Performance and thermal notes

Reduced: idle re-renders, poll frequency, hidden-app polling, per-line log I/O, and duplicated session/permission/toast state updates.
Unchanged: the always-on local OpenCode server. CPU, memory and device temperature could not be measured from this host because the app process is not visible to Termux (`run-as` denied, hidden in `/proc`); a green connection indicator is therefore not treated as evidence of background reliability.

## 8. Change inventory

- 27 modified files, 12 new files — 2 165 insertions, 383 deletions.
- Frontend: `App.jsx`, `App.css`, `ChatView`, `MessageList`, `PreviewView`, `SessionsView`, `SettingsView`, `Sidebar`, `TerminalView`, `WorkspaceTabs`, `GitHubCard`; new `AppearanceView`, `SessionTransfer`, `TodoPanel`, `ToolCard`.
- Libraries: new `agentMode`, `navigation`, `todos`, `tools`; extended `workspace`, `uiPrefs`, `views`, `github`, `opencode`, `linuxEnvironment`.
- Native: `LinuxEnvironment` (workspace binding), `GitHubPlugin` (five new Git operations), `LocalServerManager` (buffered log writer, session-store path).
- **No commit, push, or publish was performed as part of the audit itself.**
