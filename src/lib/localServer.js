import { Capacitor, registerPlugin } from "@capacitor/core";

const NativeLocalServer = Capacitor.isNativePlatform()
  ? registerPlugin("LocalServer")
  : null;

export function isLocalServerSupported() {
  return Boolean(NativeLocalServer);
}

export async function ensureLocalServer() {
  if (!NativeLocalServer) {
    throw new Error("The local OpenCode runtime is only available in the Android app.");
  }
  return NativeLocalServer.ensureStarted();
}

export async function localServerStatus() {
  if (!NativeLocalServer) return null;
  return NativeLocalServer.status();
}

export async function stopLocalServer() {
  if (!NativeLocalServer) return null;
  return NativeLocalServer.stop();
}

export async function restartLocalServer() {
  if (!NativeLocalServer) return null;
  return NativeLocalServer.restart();
}

export async function repairLocalServer() {
  if (!NativeLocalServer) return null;
  return NativeLocalServer.repair();
}

export async function localServerLogs() {
  if (!NativeLocalServer) return "";
  const result = await NativeLocalServer.logs();
  return typeof result?.logs === "string" ? result.logs : "";
}

export async function addLocalServerListener(callback) {
  if (!NativeLocalServer) return { remove() {} };
  return NativeLocalServer.addListener("progress", callback);
}
