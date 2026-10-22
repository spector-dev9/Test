import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { connectionFailure } from "../lib/connection";
import {
  getVcsDiff,
  getVcsStatus,
  listAgents,
  listCommands,
  listProviders,
} from "../lib/opencode";

const initialModels = {
  directory: null,
  status: "idle",
  data: null,
  error: null,
  errorKind: null,
};

const initialCommands = {
  directory: null,
  status: "idle",
  data: [],
  error: null,
  errorKind: null,
};

const initialChanges = {
  directory: null,
  status: "idle",
  files: [],
  diffs: [],
  error: null,
  errorKind: null,
  patchError: null,
};

export function useModelsAndCommands(directory, connected) {
  const [modelState, setModelState] = useState(initialModels);
  const [commandState, setCommandState] = useState(initialCommands);
  const [refreshToken, setRefreshToken] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!directory || !connected) return undefined;

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const controller = new AbortController();

    async function load() {
      const [providersResult, commandsResult] =
        await Promise.allSettled([
          listProviders(directory, controller.signal),
          listCommands(directory, controller.signal),
        ]);

      if (
        controller.signal.aborted ||
        requestRef.current !== requestId
      ) {
        return;
      }

      if (providersResult.status === "fulfilled") {
        setModelState({
          directory,
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
        setModelState((previous) => ({
          directory,
          status: "error",
          data:
            previous.directory === directory ? previous.data : null,
          error: failure.message,
          errorKind: failure.kind,
        }));
      }

      if (commandsResult.status === "fulfilled") {
        setCommandState({
          directory,
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
        setCommandState((previous) => ({
          directory,
          status: "error",
          data:
            previous.directory === directory ? previous.data : [],
          error: failure.message,
          errorKind: failure.kind,
        }));
      }
    }

    load();

    return () => controller.abort();
  }, [connected, directory, refreshToken]);

  const refresh = useCallback(() => {
    if (!connected || !directory) return;

    setModelState((previous) => ({
      directory,
      status:
        previous.directory === directory && previous.data
          ? "refreshing"
          : "loading",
      data: previous.directory === directory ? previous.data : null,
      error: null,
      errorKind: null,
    }));
    setCommandState((previous) => ({
      directory,
      status:
        previous.directory === directory && previous.data.length > 0
          ? "refreshing"
          : "loading",
      data: previous.directory === directory ? previous.data : [],
      error: null,
      errorKind: null,
    }));
    setRefreshToken((value) => value + 1);
  }, [connected, directory]);

  const models = useMemo(() => {
    const scoped =
      modelState.directory === directory
        ? modelState
        : {
            directory,
            status: directory && connected ? "loading" : "idle",
            data: null,
            error: null,
            errorKind: null,
          };

    return !connected && !scoped.data
      ? { ...scoped, status: "offline" }
      : scoped;
  }, [connected, directory, modelState]);

  const commands = useMemo(() => {
    const scoped =
      commandState.directory === directory
        ? commandState
        : {
            directory,
            status: directory && connected ? "loading" : "idle",
            data: [],
            error: null,
            errorKind: null,
          };

    return !connected && scoped.data.length === 0
      ? { ...scoped, status: "offline" }
      : scoped;
  }, [commandState, connected, directory]);

  return { models, commands, refresh };
}

export function useAgents(directory, connected) {
  const [state, setState] = useState({
    directory: null,
    status: "idle",
    data: [],
    error: null,
    errorKind: null,
  });
  const [refreshToken, setRefreshToken] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!directory || !connected) return undefined;

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const controller = new AbortController();

    async function load() {
      try {
        const agents = await listAgents(directory, controller.signal);

        if (
          controller.signal.aborted ||
          requestRef.current !== requestId
        ) {
          return;
        }

        setState({
          directory,
          status: "ready",
          data: agents,
          error: null,
          errorKind: null,
        });
      } catch (error) {
        if (controller.signal.aborted) return;

        const failure = connectionFailure(
          error,
          "Agents could not be loaded.",
        );

        setState((previous) => ({
          directory,
          status: "error",
          data: previous.directory === directory ? previous.data : [],
          error: failure.message,
          errorKind: failure.kind,
        }));
      }
    }

    load();

    return () => controller.abort();
  }, [connected, directory, refreshToken]);

  const refresh = useCallback(() => {
    if (!connected || !directory) return;
    setRefreshToken((value) => value + 1);
  }, [connected, directory]);

  const agents = useMemo(() => {
    if (state.directory !== directory) {
      return {
        directory,
        status: directory && connected ? "loading" : "idle",
        data: [],
        error: null,
        errorKind: null,
      };
    }

    return !connected && state.data.length === 0
      ? { ...state, status: "offline" }
      : state;
  }, [connected, directory, state]);

  return { agents, refresh };
}

export function useProjectChanges({ directory, connected, active }) {  const [changeState, setChangeState] = useState(initialChanges);
  const [refreshToken, setRefreshToken] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!active || !connected || !directory) return undefined;

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const controller = new AbortController();

    async function load() {
      const [statusResult, diffResult] = await Promise.allSettled([
        getVcsStatus(directory, controller.signal),
        getVcsDiff(directory, { mode: "git", context: 3 }, controller.signal),
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

        setChangeState({
          directory,
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
        setChangeState((previous) => ({
          directory,
          status: "error",
          files:
            previous.directory === directory ? previous.files : [],
          diffs:
            previous.directory === directory ? previous.diffs : [],
          error: failure.message,
          errorKind: failure.kind,
          patchError: null,
        }));
      }
    }

    load();

    return () => controller.abort();
  }, [active, connected, directory, refreshToken]);

  const refresh = useCallback(() => {
    if (!active || !connected || !directory) return;

    setChangeState((previous) => ({
      directory,
      status:
        previous.directory === directory && previous.files.length > 0
          ? "refreshing"
          : "loading",
      files: previous.directory === directory ? previous.files : [],
      diffs: previous.directory === directory ? previous.diffs : [],
      error: null,
      errorKind: null,
      patchError: null,
    }));
    setRefreshToken((value) => value + 1);
  }, [active, connected, directory]);

  const changes = useMemo(() => {
    const scoped =
      changeState.directory === directory
        ? changeState
        : {
            directory,
            status:
              active && connected && directory ? "loading" : "idle",
            files: [],
            diffs: [],
            error: null,
            errorKind: null,
            patchError: null,
          };

    if (active && connected && scoped.status === "idle") {
      return { ...scoped, status: "loading" };
    }

    return !connected && scoped.files.length === 0
      ? { ...scoped, status: "offline" }
      : scoped;
  }, [active, changeState, connected, directory]);

  return { changes, refresh };
}
