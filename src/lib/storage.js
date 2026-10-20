import { Capacitor, registerPlugin } from "@capacitor/core";
import { normalizeProjectDirectory } from "./project.js";

const NativeStorage = Capacitor.isNativePlatform()
  ? registerPlugin("Storage")
  : null;

export function isStorageSupported() {
  return Boolean(NativeStorage);
}

export async function storageStatus() {
  if (!NativeStorage) return null;
  return NativeStorage.status();
}

export async function requestStorageAccess() {
  if (!NativeStorage) {
    throw new Error("Storage access is only available in the Android app.");
  }
  return NativeStorage.requestAccess();
}

export async function pickWorkspaceDirectory() {
  if (!NativeStorage) {
    throw new Error("The folder picker is only available in the Android app.");
  }

  const result = await NativeStorage.pickDirectory();
  if (!result || result.cancelled) return null;

  const path = normalizeProjectDirectory(result.path);
  if (!path) {
    throw new Error("The selected folder path is not supported.");
  }

  return {
    path,
    name:
      typeof result.name === "string" && result.name.trim()
        ? result.name.trim()
        : path,
  };
}
