# OpenCode Mobile

A Capacitor Android client for a local OpenCode server. The app connects to the
exact loopback origin `http://127.0.0.1:4096` and is scoped to this project's
workspace.

## Features

- Create and open project sessions.
- Read conversations and send prompts asynchronously, with polling for replies.
- Stop a running agent and retry a failed send.
- Run project slash commands from the composer.
- Choose an OpenCode model for new prompts and sessions.
- Review uncommitted VCS files and patches for this project.
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

The test suite covers URL policy, native request validation, SDK request
shapes, API error mapping, and workspace presentation helpers.

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
any other origin. Requests are restricted to health, project sessions, session
messages, prompts, commands, abort, providers, commands, and VCS status/diff.

Browser requests have a finite timeout and are cancelled when the view is
replaced or unmounted. Native Android requests use the Capacitor HTTP transport
with a 10-second connect timeout, a 30-second read timeout, and a 5 MiB response
limit.

The server URL and project directory are compiled into the app. Changing either
requires a deliberate source and native-policy change followed by a rebuild.
No OpenCode credentials are stored by the app.

## Release policy

The Android workflow builds a debug APK only. Debug builds permit cleartext HTTP
only for loopback (`localhost` and `127.0.0.1`) through the debug network
security config.

Release builds intentionally do not allow cleartext HTTP. A release build needs
a separately designed secure connection strategy, such as HTTPS with a trusted
certificate, before it can connect to OpenCode. Do not add a release cleartext
exception as part of debug-only work.
