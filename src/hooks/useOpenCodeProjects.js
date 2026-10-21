import { useCallback, useEffect, useRef, useState } from "react";
import { connectionFailure } from "../lib/connection.js";
import {
  checkConnection,
  listProjects,
} from "../lib/opencode.js";

const HEALTHY_POLL_MS = 20000;
const HIDDEN_HEALTHY_POLL_MS = 60000;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30000;

export function retryDelayMs(failures) {
  const count = Number(failures);
  const safeCount =
    Number.isFinite(count) && count >= 1 ? Math.floor(count) : 1;
  const exponent = safeCount - 1;
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** exponent);
}

const initialHealth = {
  status: "loading",
  data: null,
  error: null,
  errorKind: null,
  retrying: false,
};

const initialProjects = {
  status: "loading",
  data: [],
  error: null,
  errorKind: null,
};

export function useOpenCodeProjects() {
  const [health, setHealth] = useState(initialHealth);
  const [projects, setProjects] = useState(initialProjects);
  const [runToken, setRunToken] = useState(0);
  const requestRef = useRef(0);
  const failuresRef = useRef(0);
  const connectedRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let controller = null;
    let timer = null;

    async function attempt() {
      const runId = requestRef.current + 1;
      requestRef.current = runId;
      controller = new AbortController();

      const [healthResult, projectsResult] = await Promise.allSettled([
        checkConnection(controller.signal),
        listProjects(controller.signal),
      ]);

      if (disposed || requestRef.current !== runId) {
        return null;
      }

      let healthy = false;

      if (healthResult.status === "fulfilled") {
        healthy = true;
        failuresRef.current = 0;
        connectedRef.current = true;
        setHealth({
          status: "online",
          data: healthResult.value,
          error: null,
          errorKind: null,
          retrying: false,
        });
      } else {
        const failure = connectionFailure(
          healthResult.reason,
          "The OpenCode server could not be reached.",
        );
        failuresRef.current += 1;
        setHealth({
          status: "offline",
          data: null,
          error: failure.message,
          errorKind: failure.kind,
          retrying: connectedRef.current,
        });
      }

      if (projectsResult.status === "fulfilled") {
        setProjects({
          status: "ready",
          data: projectsResult.value,
          error: null,
          errorKind: null,
        });
      } else {
        const failure = connectionFailure(
          projectsResult.reason,
          "Projects could not be loaded.",
        );
        setProjects((previous) => ({
          status: "error",
          data: previous.data,
          error: failure.message,
          errorKind: failure.kind,
        }));
      }

      return healthy;
    }

    async function loop() {
      let healthy;

      try {
        healthy = await attempt();
      } catch {
        failuresRef.current += 1;
        healthy = false;
      }

      if (disposed || healthy === null) return;

      const delay = healthy
        ? typeof document !== "undefined" &&
          document.visibilityState === "hidden"
          ? HIDDEN_HEALTHY_POLL_MS
          : HEALTHY_POLL_MS
        : retryDelayMs(failuresRef.current);

      timer = window.setTimeout(() => {
        loop();
      }, delay);
    }

    loop();

    return () => {
      disposed = true;
      if (controller) controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [runToken]);

  const refresh = useCallback(() => {
    setHealth((previous) => ({
      status: previous.data ? "refreshing" : "loading",
      data: previous.data,
      error: null,
      errorKind: null,
      retrying: false,
    }));
    setProjects((previous) => ({
      status: previous.data.length > 0 ? "refreshing" : "loading",
      data: previous.data,
      error: null,
      errorKind: null,
    }));
    setRunToken((value) => value + 1);
  }, []);

  return { health, projects, refresh };
}
