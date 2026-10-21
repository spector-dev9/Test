import { Capacitor, registerPlugin } from "@capacitor/core";

const NativeLinuxEnvironment = Capacitor.isNativePlatform()
  ? registerPlugin("LinuxEnvironment")
  : null;

export function isLinuxEnvironmentSupported() {
  return Boolean(NativeLinuxEnvironment);
}

export async function isLinuxEnvironmentReady() {
  if (!NativeLinuxEnvironment) {
    return { ready: false, rootfsPath: "" };
  }
  return NativeLinuxEnvironment.isReady();
}

export async function ensureLinuxEnvironment() {
  if (!NativeLinuxEnvironment) {
    throw new Error("The Linux environment is only available in the Android app.");
  }
  return NativeLinuxEnvironment.ensureLinux();
}

export async function runLinuxCommand(command) {
  if (typeof command !== "string" || !command.trim()) {
    throw new Error("A command is required.");
  }
  if (!NativeLinuxEnvironment) {
    throw new Error("The Linux environment is only available in the Android app.");
  }
  return NativeLinuxEnvironment.runCommand({ command });
}

export async function installLinuxPackage(pkg) {
  if (typeof pkg !== "string" || !pkg.trim()) {
    throw new Error("A package name is required.");
  }
  if (!NativeLinuxEnvironment) {
    throw new Error("The Linux environment is only available in the Android app.");
  }
  return NativeLinuxEnvironment.installPackage({ package: pkg });
}

export async function linuxRootfsPath() {
  if (!NativeLinuxEnvironment) {
    return "";
  }
  const result = await NativeLinuxEnvironment.rootfsPath();
  return typeof result?.path === "string" ? result.path : "";
}
