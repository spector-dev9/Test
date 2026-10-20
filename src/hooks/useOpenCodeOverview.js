import { useCallback, useEffect, useRef, useState } from "react";
import { connectionFailure } from "../lib/connection";
import {
  checkConnection,
  createProjectSession,
  listProjectSessions,
} from "../lib/opencode";

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
  const [creatingSession, setCreatingSession] = useState(false);
  const [createError, setCreateError] = useState(null);
  const requestId = useRef(0);
  const createController = useRef(null);
  const creatingRef = useRef(false);

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

  useEffect(
    () => () => {
      createController.current?.abort();
    },
    [],
  );

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

  const createSession = useCallback(async ({ title, model } = {}) => {
    if (creatingRef.current) return null;

    creatingRef.current = true;
    setCreatingSession(true);
    setCreateError(null);

    const controller = new AbortController();
    createController.current = controller;

    try {
      const session = await createProjectSession(
        { title, model },
        controller.signal,
      );

      setSessions((previous) => ({
        status: "ready",
        data: [
          session,
          ...previous.data.filter((item) => item.id !== session.id),
        ],
        error: null,
        errorKind: null,
      }));

      return session;
    } catch (error) {
      if (error?.kind === "aborted") return null;

      const failure = connectionFailure(
        error,
        "The session could not be created.",
      );
      setCreateError(failure);
      return null;
    } finally {
      creatingRef.current = false;
      createController.current = null;
      setCreatingSession(false);
    }
  }, []);

  const clearCreateError = useCallback(() => {
    setCreateError(null);
  }, []);

  return {
    health,
    sessions,
    refresh,
    createSession,
    creatingSession,
    createError,
    clearCreateError,
  };
}
