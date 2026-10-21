import assert from "node:assert/strict";
import test from "node:test";
import * as localServer from "./localServer.js";

test("localServer wrappers are unavailable outside native", async () => {
  assert.equal(localServer.isLocalServerSupported(), false);

  await assert.rejects(
    localServer.ensureLocalServer(),
    /only available in the Android app|plugin is not implemented on web/
  );

  assert.equal(await localServer.localServerStatus(), null);
  assert.equal(await localServer.stopLocalServer(), null);
  assert.equal(await localServer.restartLocalServer(), null);
  assert.equal(await localServer.repairLocalServer(), null);
  assert.equal(await localServer.localServerLogs(), "");

  assert.equal(await localServer.localServerLogs(), "");

  const remove = await localServer.addLocalServerListener(() => {});
  assert.equal(typeof remove.remove, "function");
  remove.remove();
});
