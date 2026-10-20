import { useCallback, useEffect, useRef, useState } from "react";
import {
  addLocalServerListener,
  ensureLocalServer,
  isLocalServerSupported,
  repairLocalServer,
  restartLocalServer,
  stopLocalServer,
} from "../lib/localServer";

const native = isLocalServerSupported();

const INITIAL_STATE = Object.freeze({
  state: native ? "idle" : "unavailable",
  progress: 0,
  message: "",
  error: "",
  version: "",
  workspace: "",
  installed: false,
  running: false,
  url: "",
});

export function useLocalServer() {
  const [status, setStatus] = useState(INITIAL_STATE);
  const mountedRef = useRef(true);
  const startingRef = useRef(false);

  const apply = useCallback((payload) => {
    if (!mountedRef.current || !payload || typeof payload !== "object") return;

    setStatus((previous) => ({
      ...previous,
      ...payload,
      error: typeof payload.error === "string" ? payload.error : "",
    }));

    if (payload.state === "running" || payload.state === "error") {
      startingRef.current = false;
    }
  }, []);

  const start = useCallback(async () => {
    if (!native || startingRef.current) return null;
    startingRef.current = true;

    setStatus((previous) => ({
      ...previous,
      state: previous.state === "idle" ? "preparing" : previous.state,
      message: previous.message || "Preparing the local OpenCode runtime",
      error: "",
    }));

    try {
      const result = await ensureLocalServer();
      apply(result);
      return result;
    } catch (failure) {
      startingRef.current = false;
      if (mountedRef.current) {
        setStatus((previous) => ({
          ...previous,
          state: "error",
          progress: 0,
          message: "The local OpenCode server could not start",
          error:
            typeof failure?.message === "string" && failure.message
              ? failure.message
              : "The local OpenCode server could not start.",
        }));
      }
      return null;
    }
  }, [apply]);

  const stop = useCallback(async () => {
    if (!native) return null;
    startingRef.current = false;
    try {
      const result = await stopLocalServer();
      apply(result);
      return result;
    } catch (failure) {
      apply({
        state: "error",
        message: "The local server could not be stopped",
        error: failure?.message || "The local server could not be stopped.",
      });
      return null;
    }
  }, [apply]);

  const restart = useCallback(async () => {
    if (!native) return null;
    startingRef.current = true;
    try {
      const result = await restartLocalServer();
      apply(result);
      return result;
    } catch (failure) {
      startingRef.current = false;
      apply({
        state: "error",
        message: "The local server could not be restarted",
        error: failure?.message || "The local server could not be restarted.",
      });
      return null;
    }
  }, [apply]);

  const repair = useCallback(async () => {
    if (!native) return null;
    startingRef.current = true;
    try {
      const result = await repairLocalServer();
      apply(result);
      return result;
    } catch (failure) {
      startingRef.current = false;
      apply({
        state: "error",
        message: "The local runtime could not be repaired",
        error: failure?.message || "The local runtime could not be repaired.",
      });
      return null;
    }
  }, [apply]);

  useEffect(() => {
    mountedRef.current = true;
    if (!native) return undefined;

    let disposed = false;
    let handle = null;

    addLocalServerListener((payload) => {
      if (!disposed) apply(payload);
    }).then((registered) => {
      handle = registered;
      if (disposed) registered?.remove?.();
    });

    start();

    return () => {
      disposed = true;
      mountedRef.current = false;
      handle?.remove?.();
    };
  }, [apply, start]);

  return {
    ...status,
    supported: native,
    start,
    retry: start,
    stop,
    restart,
    repair,
  };
}
