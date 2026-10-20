import { useCallback, useEffect, useRef, useState } from "react";
import { connectionFailure } from "../lib/connection";
import {
  getVcsDiff,
  getVcsStatus,
  listCommands,
  listProviders,
} from "../lib/opencode";

const initialModels = {
  status: "idle",
  data: null,
  error: null,
  errorKind: null,
};

const initialCommands = {
  status: "idle",
  data: [],
  error: null,
  errorKind: null,
};

const initialChanges = {
  status: "idle",
  files: [],
  diffs: [],
  error: null,
  errorKind: null,
  patchError: null,
};

export function useModelsAndCommands(connected) {
  const [models, setModels] = useState(initialModels);
  const [commands, setCommands] = useState(initialCommands);
  const [refreshToken, setRefreshToken] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!connected) return undefined;

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const controller = new AbortController();

    async function load() {
      setModels((previous) => ({
        status: previous.data ? "refreshing" : "loading",
        data: previous.data,
        error: null,
        errorKind: null,
      }));
      setCommands((previous) => ({
        status: previous.data.length > 0 ? "refreshing" : "loading",
        data: previous.data,
        error: null,
        errorKind: null,
      }));

      const [providersResult, commandsResult] =
        await Promise.allSettled([
          listProviders(controller.signal),
          listCommands(controller.signal),
        ]);

      if (
        controller.signal.aborted ||
        requestRef.current !== requestId
      ) {
        return;
      }

      if (providersResult.status === "fulfilled") {
        setModels({
          status: "ready",
          data: providersResult.value,
          error: null,
          errorKind: null,
        });
      } else {
        const failure = connectionFailure(
          providersResult.reason,
          "Models could not be loaded.",
        );
        setModels((previous) => ({
          status: "error",
          data: previous.data,
          error: failure.message,
          errorKind: failure.kind,
        }));
      }

      if (commandsResult.status === "fulfilled") {
        setCommands({
          status: "ready",
          data: commandsResult.value,
          error: null,
          errorKind: null,
        });
      } else {
        const failure = connectionFailure(
          commandsResult.reason,
          "Commands could not be loaded.",
        );
        setCommands((previous) => ({
          status: "error",
          data: previous.data,
          error: failure.message,
          errorKind: failure.kind,
        }));
      }
    }

    load();

    return () => controller.abort();
  }, [connected, refreshToken]);

  const refresh = useCallback(() => {
    if (!connected) return;
    setRefreshToken((value) => value + 1);
  }, [connected]);

  const visibleModels =
    !connected && !models.data
      ? { ...models, status: "offline" }
      : models;
  const visibleCommands =
    !connected && commands.data.length === 0
      ? { ...commands, status: "offline" }
      : commands;

  return {
    models: visibleModels,
    commands: visibleCommands,
    refresh,
  };
}

export function useProjectChanges({ connected, active }) {
  const [changes, setChanges] = useState(initialChanges);
  const [refreshToken, setRefreshToken] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!active) return undefined;

    if (!connected) return undefined;

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const controller = new AbortController();

    async function load() {
      setChanges((previous) => ({
        status: previous.files.length > 0 ? "refreshing" : "loading",
        files: previous.files,
        diffs: previous.diffs,
        error: null,
        errorKind: null,
        patchError: null,
      }));

      const [statusResult, diffResult] = await Promise.allSettled([
        getVcsStatus(controller.signal),
        getVcsDiff({ mode: "git", context: 3 }, controller.signal),
      ]);

      if (
        controller.signal.aborted ||
        requestRef.current !== requestId
      ) {
        return;
      }

      if (statusResult.status === "fulfilled") {
        const failure =
          diffResult.status === "rejected"
            ? connectionFailure(
                diffResult.reason,
                "File patches could not be loaded.",
              )
            : null;

        setChanges({
          status: "ready",
          files: statusResult.value,
          diffs:
            diffResult.status === "fulfilled" ? diffResult.value : [],
          error: null,
          errorKind: null,
          patchError: failure?.message ?? null,
        });
      } else {
        const failure = connectionFailure(
          statusResult.reason,
          "Changes could not be loaded.",
        );
        setChanges((previous) => ({
          status: "error",
          files: previous.files,
          diffs: previous.diffs,
          error: failure.message,
          errorKind: failure.kind,
          patchError: null,
        }));
      }
    }

    load();

    return () => controller.abort();
  }, [active, connected, refreshToken]);

  const refresh = useCallback(() => {
    if (!active || !connected) return;
    setRefreshToken((value) => value + 1);
  }, [active, connected]);

  const visibleChanges =
    !connected && changes.files.length === 0
      ? { ...changes, status: "offline" }
      : changes;

  return { changes: visibleChanges, refresh };
}
