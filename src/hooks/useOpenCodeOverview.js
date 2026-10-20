import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { connectionFailure } from "../lib/connection";
import {
  createProjectSession,
  deleteSession as deleteSessionRequest,
  listProjectSessions,
  updateSession as updateSessionRequest,
} from "../lib/opencode";

const initialSessions = {
  directory: null,
  status: "idle",
  data: [],
  error: null,
  errorKind: null,
};

export function useOpenCodeOverview({ directory, enabled }) {
  const [sessionState, setSessionState] = useState(initialSessions);
  const [refreshToken, setRefreshToken] = useState(0);
  const [creatingSession, setCreatingSession] = useState(false);
  const [createError, setCreateError] = useState(null);
  const requestRef = useRef(0);
  const createController = useRef(null);
  const creatingRef = useRef(false);

  const sessions = useMemo(() => {
    if (sessionState.directory !== directory) {
      return {
        status: directory && enabled ? "loading" : "idle",
        data: [],
        error: null,
        errorKind: null,
      };
    }

    if (!enabled && sessionState.status === "loading") {
      return { ...sessionState, status: "idle" };
    }

    return sessionState;
  }, [directory, enabled, sessionState]);

  useEffect(() => {
    if (!directory || !enabled) return undefined;

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const controller = new AbortController();

    async function load() {
      try {
        const data = await listProjectSessions(
          directory,
          controller.signal,
        );

        if (
          controller.signal.aborted ||
          requestRef.current !== requestId
        ) {
          return;
        }

        setSessionState({
          directory,
          status: "ready",
          data,
          error: null,
          errorKind: null,
        });
      } catch (error) {
        if (
          controller.signal.aborted ||
          requestRef.current !== requestId
        ) {
          return;
        }

        const failure = connectionFailure(
          error,
          "Sessions could not be loaded.",
        );
        setSessionState((previous) => ({
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
  }, [directory, enabled, refreshToken]);

  useEffect(() => {
    return () => createController.current?.abort();
  }, [directory]);

  const refresh = useCallback(() => {
    if (!directory || !enabled) return;

    setSessionState((previous) => ({
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
  }, [directory, enabled]);

  const createSession = useCallback(
    async ({ title, model } = {}) => {
      if (!directory || !enabled || creatingRef.current) {
        return null;
      }

      creatingRef.current = true;
      setCreatingSession(true);
      setCreateError(null);

      const controller = new AbortController();
      createController.current = controller;
      const targetDirectory = directory;

      try {
        const session = await createProjectSession(
          targetDirectory,
          { title, model },
          controller.signal,
        );

        setSessionState((previous) => {
          if (previous.directory !== targetDirectory) return previous;

          return {
            ...previous,
            status: "ready",
            data: [
              session,
              ...previous.data.filter((item) => item.id !== session.id),
            ],
            error: null,
            errorKind: null,
          };
        });

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
    },
    [directory, enabled],
  );

  const renameSession = useCallback(
    async (sessionID, title) => {
      if (!directory) {
        return {
          ok: false,
          error: { message: "No project is selected." },
        };
      }

      const targetDirectory = directory;

      try {
        const session = await updateSessionRequest(
          targetDirectory,
          sessionID,
          { title },
        );

        setSessionState((previous) => {
          if (previous.directory !== targetDirectory) return previous;

          return {
            ...previous,
            status: "ready",
            data: previous.data.map((item) =>
              item.id === session.id ? session : item,
            ),
          };
        });

        return { ok: true, session };
      } catch (error) {
        return {
          ok: false,
          error: connectionFailure(
            error,
            "The session could not be renamed.",
          ),
        };
      }
    },
    [directory],
  );

  const setSessionArchived = useCallback(
    async (sessionID, archived) => {
      if (!directory) {
        return {
          ok: false,
          error: { message: "No project is selected." },
        };
      }

      const targetDirectory = directory;

      try {
        const session = await updateSessionRequest(
          targetDirectory,
          sessionID,
          { archived: archived ? Date.now() : 0 },
        );

        setSessionState((previous) => {
          if (previous.directory !== targetDirectory) return previous;

          return {
            ...previous,
            status: "ready",
            data: previous.data.map((item) =>
              item.id === session.id ? session : item,
            ),
          };
        });

        return { ok: true, session };
      } catch (error) {
        return {
          ok: false,
          error: connectionFailure(
            error,
            archived
              ? "The session could not be archived."
              : "The session could not be restored.",
          ),
        };
      }
    },
    [directory],
  );

  const deleteSession = useCallback(
    async (sessionID) => {
      if (!directory) {
        return {
          ok: false,
          error: { message: "No project is selected." },
        };
      }

      const targetDirectory = directory;

      try {
        await deleteSessionRequest(targetDirectory, sessionID);

        setSessionState((previous) => {
          if (previous.directory !== targetDirectory) return previous;

          return {
            ...previous,
            status: "ready",
            data: previous.data.filter((item) => item.id !== sessionID),
          };
        });

        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: connectionFailure(
            error,
            "The session could not be deleted.",
          ),
        };
      }
    },
    [directory],
  );

  const clearCreateError = useCallback(() => {
    setCreateError(null);
  }, []);

  return {
    sessions,
    refresh,
    createSession,
    creatingSession,
    createError,
    clearCreateError,
    renameSession,
    setSessionArchived,
    deleteSession,
  };
}
