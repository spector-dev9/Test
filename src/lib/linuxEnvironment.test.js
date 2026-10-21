import assert from "node:assert/strict";
import test from "node:test";
import * as linuxEnvironment from "./linuxEnvironment.js";

test("linuxEnvironment wrappers are unavailable outside native", async () => {
  assert.equal(linuxEnvironment.isLinuxEnvironmentSupported(), false);

  const ready = await linuxEnvironment.isLinuxEnvironmentReady();
  assert.equal(ready.ready, false);
  assert.equal(ready.rootfsPath, "");

  await assert.rejects(
    linuxEnvironment.ensureLinuxEnvironment(),
    /only available in the Android app/
  );

  await assert.rejects(
    linuxEnvironment.runLinuxCommand("echo hi"),
    /only available in the Android app/
  );

  await assert.rejects(
    linuxEnvironment.installLinuxPackage("python3"),
    /only available in the Android app/
  );

  assert.equal(await linuxEnvironment.linuxRootfsPath(), "");

  await assert.rejects(
    linuxEnvironment.runLinuxCommand(""),
    /A command is required./
  );

  await assert.rejects(
    linuxEnvironment.installLinuxPackage(""),
    /A package name is required./
  );
});
