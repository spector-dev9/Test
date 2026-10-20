# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Connection

The app connects to the OpenCode API at `http://127.0.0.1:4096` by default. Set `VITE_OPENCODE_URL` at build time only when it matches the native transport allowlist. Native Android builds reject any origin, path, or query other than the exact loopback origin used by the app.

Browser requests have a finite timeout and are cancelled when the view is replaced or unmounted. Native Android requests keep the Capacitor HTTP transport with its own 10-second connect timeout and 30-second read timeout.

## Release policy

The Android workflow builds a debug APK only. Debug builds permit cleartext HTTP only for loopback (`localhost` and `127.0.0.1`) through the debug network security config.

Release builds intentionally do not allow cleartext HTTP. A release build needs a separately designed secure connection strategy, such as HTTPS with a trusted certificate, before it can connect to OpenCode. Do not add a release cleartext exception as part of debug-only work.

