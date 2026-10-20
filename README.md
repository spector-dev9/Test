# OpenCode Mobile

A Capacitor Android client for a local OpenCode server. The app connects to the
exact loopback origin `http://127.0.0.1:4096` and scopes every request to the
currently selected OpenCode project.

## Features

- Discover OpenCode projects and switch the active project.
- Create, rename, archive, restore, and permanently delete project sessions.
- Search sessions by title, agent, or model, and show or hide archived sessions.
- Read conversations and send prompts asynchronously, with polling for replies.
- Stop a running agent and retry a failed send.
- Review and explicitly answer pending permission requests.
- Run project slash commands from the composer.
- Choose an OpenCode model for new prompts and sessions.
- Review uncommitted VCS files and patches for the active project.
- Inspect connection diagnostics and request-policy details.

## Requirements

- Node.js 22 or newer.
- An OpenCode server running on `http://127.0.0.1:4096`.
- For Android builds: JDK 21 and the Android SDK.

## Development

```sh
npm ci
npm run dev
```

The browser build talks to the server with `fetch`. The server may not return
CORS headers for browser origins, so successful browser access depends on the
server's CORS policy. The Android build uses native `CapacitorHttp` and does not
depend on browser CORS.

## Checks

```sh
npm test
npm run lint
npm run build
npm run sync:android
```

The test suite covers URL policy, native request validation, project discovery
and scoping, session management, permissions, SDK request shapes, API error
mapping, and workspace presentation helpers.

## Android build

```sh
npm run build
npm run sync:android
cd android
./gradlew assembleDebug
```

The GitHub Actions workflow in `.github/workflows/android-debug-apk.yml` builds,
verifies, and uploads `opencode-mobile-debug.apk` for pushes to `main` and manual
runs.

## Connection policy

The app connects to `http://127.0.0.1:4096` by default. Set
`VITE_OPENCODE_URL` at build time only when the resulting origin, path, and query
shapes still match the native transport allowlist. Native Android builds reject
any other origin. Requests are restricted to health and project discovery,
project-scoped session lists and messages, session create/update/delete,
prompts, commands, abort, permissions and replies, providers, commands, and VCS
status/diff.

Project-scoped requests must include exactly one `directory` query matching a
project previously returned by the trusted project-list endpoint. The native
allowlist starts with this app's workspace and expands only through project
discovery, so arbitrary filesystem paths remain unavailable.

Browser requests have a finite timeout and are cancelled when the view is
replaced or unmounted. Native Android requests use the Capacitor HTTP transport
with a 10-second connect timeout, a 30-second read timeout, and a 5 MiB response
limit.

The server URL is compiled into the app. Changing it requires a deliberate
source and native-policy change followed by a rebuild. Project selection is
stored locally and can be changed in the app. No OpenCode credentials are stored
by the app.

## Release policy

The Android workflow builds a debug APK only. Debug builds permit cleartext HTTP
only for loopback (`localhost` and `127.0.0.1`) through the debug network
security config.

Release builds intentionally do not allow cleartext HTTP. A release build needs
a separately designed secure connection strategy, such as HTTPS with a trusted
certificate, before it can connect to OpenCode. Do not add a release cleartext
exception as part of debug-only work.

## Known limitations

- Conversation updates use polling because the native HTTP bridge does not
  expose server-sent events. There is no token-by-token streaming.
- The app must run on the same device as the OpenCode server because the native
  policy permits only the exact loopback origin.
- Archived sessions are filtered in the client because the current server's
  normal session list still includes them.
