import { useCallback, useEffect, useRef, useState } from "react";
import { connectionFailure } from "../lib/connection";
import {
  checkConnection,
  listProjects,
} from "../lib/opencode";

const initialHealth = {
  status: "loading",
  data: null,
  error: null,
  errorKind: null,
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
  const [refreshToken, setRefreshToken] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const controller = new AbortController();

    async function load() {
      const [healthResult, projectsResult] = await Promise.allSettled([
        checkConnection(controller.signal),
        listProjects(controller.signal),
      ]);

      if (
        controller.signal.aborted ||
        requestRef.current !== requestId
      ) {
        return;
      }

      if (healthResult.status === "fulfilled") {
        setHealth({
          status: "online",
          data: healthResult.value,
          error: null,
          errorKind: null,
        });
      } else {
        const failure = connectionFailure(
          healthResult.reason,
          "The OpenCode server could not be reached.",
        );
        setHealth({
          status: "offline",
          data: null,
          error: failure.message,
          errorKind: failure.kind,
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
    }

    load();

    return () => controller.abort();
  }, [refreshToken]);

  const refresh = useCallback(() => {
    setHealth((previous) => ({
      status: previous.data ? "refreshing" : "loading",
      data: previous.data,
      error: null,
      errorKind: null,
    }));
    setProjects((previous) => ({
      status: previous.data.length > 0 ? "refreshing" : "loading",
      data: previous.data,
      error: null,
      errorKind: null,
    }));
    setRefreshToken((value) => value + 1);
  }, []);

  return { health, projects, refresh };
}
