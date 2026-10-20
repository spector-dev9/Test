import { useCallback, useEffect, useRef, useState } from "react";
import { connectionFailure } from "../lib/connection";
import { checkConnection, listProjectSessions } from "../lib/opencode";

const initialHealth = {
  status: "loading",
  data: null,
  error: null,
  errorKind: null,
};

const initialSessions = {
  status: "loading",
  data: [],
  error: null,
  errorKind: null,
};

export function useOpenCodeOverview() {
  const [health, setHealth] = useState(initialHealth);
  const [sessions, setSessions] = useState(initialSessions);
  const [refreshToken, setRefreshToken] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;
    const controller = new AbortController();
    let cancelled = false;

    async function load() {
      const [healthResult, sessionsResult] = await Promise.allSettled([
        checkConnection(controller.signal),
        listProjectSessions(controller.signal),
      ]);

      if (cancelled || requestId.current !== currentRequest) return;

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

      if (sessionsResult.status === "fulfilled") {
        setSessions({
          status: "ready",
          data: sessionsResult.value,
          error: null,
          errorKind: null,
        });
      } else {
        const failure = connectionFailure(
          sessionsResult.reason,
          "Sessions could not be loaded.",
        );
        setSessions((previous) => ({
          status: "error",
          data: previous.data,
          error: failure.message,
          errorKind: failure.kind,
        }));
      }
    }

    load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [refreshToken]);

  const refresh = useCallback(() => {
    setHealth((previous) => ({
      status: previous.data ? "refreshing" : "loading",
      data: previous.data,
      error: null,
      errorKind: null,
    }));
    setSessions((previous) => ({
      status: previous.data.length > 0 ? "refreshing" : "loading",
      data: previous.data,
      error: null,
      errorKind: null,
    }));
    setRefreshToken((value) => value + 1);
  }, []);

  return { health, sessions, refresh };
}
