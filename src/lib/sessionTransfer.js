import { Capacitor, registerPlugin } from "@capacitor/core";

const NativeStorage = Capacitor.isNativePlatform()
  ? registerPlugin("Storage")
  : null;
const NativeLocalServer = Capacitor.isNativePlatform()
  ? registerPlugin("LocalServer")
  : null;

export function isSessionTransferSupported() {
  return Boolean(NativeStorage && NativeLocalServer);
}

export function sessionExportFileName(session) {
  const raw = session?.title || session?.slug || session?.id || "";
  const slug = String(raw)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+$/, "")
    .slice(0, 64);
  return `${slug || "session"}.json`;
}

export function formatTransferBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ["KB", "MB", "GB"];
  let scaled = value;
  let unit = "B";
  for (const next of units) {
    if (scaled < 1024) break;
    scaled /= 1024;
    unit = next;
  }
  const rounded = scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
  return `${rounded} ${unit}`;
}

function requireNative(operation) {
  if (!isSessionTransferSupported()) {
    throw new Error(`${operation} is only available in the Android app.`);
  }
}

export async function pickSessionImportFile() {
  requireNative("Session import");
  const result = await NativeStorage.pickDocument({
    mimeTypes: ["application/json", "text/json", "*/*"],
  });
  if (!result || result.cancelled || !result.uri) return null;
  return { uri: result.uri, name: result.name || "session.json" };
}

export async function pickSessionExportTarget(fileName) {
  requireNative("Session export");
  const result = await NativeStorage.createDocument({
    name: fileName,
    mime: "application/json",
  });
  if (!result || result.cancelled || !result.uri) return null;
  return { uri: result.uri, name: result.name || fileName };
}

export async function exportSessionToFile({ sessionID, uri }) {
  requireNative("Session export");
  const result = await NativeLocalServer.exportSession({ sessionID, uri });
  return {
    bytes: Number(result?.bytes ?? 0),
    output: typeof result?.output === "string" ? result.output : "",
  };
}

export async function importSessionFromFile({ uri }) {
  requireNative("Session import");
  const result = await NativeLocalServer.importSession({ uri });
  return { output: typeof result?.output === "string" ? result.output : "" };
}
