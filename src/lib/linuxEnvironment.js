import { Capacitor, registerPlugin } from "@capacitor/core";

const NativeLinuxEnvironment = Capacitor.isNativePlatform()
  ? registerPlugin("LinuxEnvironment")
  : null;

export function isLinuxEnvironmentSupported() {
  return Boolean(NativeLinuxEnvironment);
}

export async function isLinuxEnvironmentReady() {
  if (!NativeLinuxEnvironment) {
    return { ready: false, rootfsPath: "", reason: "" };
  }
  const result = await NativeLinuxEnvironment.isReady();
  return {
    ready: Boolean(result?.ready),
    rootfsPath: typeof result?.rootfsPath === "string" ? result.rootfsPath : "",
    reason: typeof result?.reason === "string" ? result.reason : "",
  };
}

export async function ensureLinuxEnvironment() {
  if (!NativeLinuxEnvironment) {
    throw new Error("The Linux environment is only available in the Android app.");
  }
  return NativeLinuxEnvironment.ensureLinux();
}

export async function linuxGuestShell(directory) {
  if (!NativeLinuxEnvironment) {
    throw new Error("The Linux environment is only available in the Android app.");
  }
  const result = await NativeLinuxEnvironment.guestShell({
    ...(directory ? { directory } : {}),
  });

  const args = Array.isArray(result?.args) ? result.args : [];
  const env = {};

  if (result?.env && typeof result.env === "object") {
    for (const [key, value] of Object.entries(result.env)) {
      if (typeof value === "string") env[key] = value;
    }
  }

  return {
    command: typeof result?.command === "string" ? result.command : "",
    args: args.filter((argument) => typeof argument === "string"),
    cwd: typeof result?.cwd === "string" ? result.cwd : "",
    env,
    rootfs: typeof result?.rootfs === "string" ? result.rootfs : "",
  };
}

export async function runLinuxCommand(command, directory) {
  if (typeof command !== "string" || !command.trim()) {
    throw new Error("A command is required.");
  }
  if (!NativeLinuxEnvironment) {
    throw new Error("The Linux environment is only available in the Android app.");
  }
  return NativeLinuxEnvironment.runCommand({
    command,
    ...(directory ? { directory } : {}),
  });
}

export async function installLinuxPackage(pkg, directory) {
  if (typeof pkg !== "string" || !pkg.trim()) {
    throw new Error("A package name is required.");
  }
  if (!NativeLinuxEnvironment) {
    throw new Error("The Linux environment is only available in the Android app.");
  }
  return NativeLinuxEnvironment.installPackage({
    package: pkg,
    ...(directory ? { directory } : {}),
  });
}

export async function linuxRootfsPath() {
  if (!NativeLinuxEnvironment) {
    return "";
  }
  const result = await NativeLinuxEnvironment.rootfsPath();
  return typeof result?.path === "string" ? result.path : "";
}
