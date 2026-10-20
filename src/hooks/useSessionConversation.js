import { useCallback, useEffect, useRef, useState } from "react";
import { connectionFailure } from "../lib/connection";
import {
  abortSession,
  getSessionStatuses,
  listSessionMessages,
  sendCommand,
  sendPromptAsync,
} from "../lib/opencode";
import { isConversationSettled } from "../lib/workspace";

const initialMessages = {
  status: "idle",
  data: [],
  error: null,
  errorKind: null,
};

const POLL_INTERVAL_MS = 1400;
const POLL_FAILURE_LIMIT = 3;

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);

    if (!signal) return;

    const handleAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Cancelled", "AbortError"));
    };

    if (signal.aborted) {
      handleAbort();
      return;
    }

    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

function statusIsBusy(status) {
  return status?.type === "busy" || status?.type === "retry";
}

function actionFailure(error, fallback) {
  const failure = connectionFailure(error, fallback);

  if (failure.status === 409) {
    return {
      ...failure,
      message: "The agent is already working in this session.",
    };
  }

  return failure;
}

async function loadSnapshot(sessionID, signal) {
  const [messages, statuses] = await Promise.allSettled([
    listSessionMessages(sessionID, signal),
    getSessionStatuses(signal),
  ]);

  return { messages, statuses };
}

export function useSessionConversation({
  sessionId,
  enabled,
  onRefreshSessions,
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [phase, setPhase] = useState("idle");
  const [actionError, setActionError] = useState(null);
  const [lastSubmission, setLastSubmission] = useState(null);
  const phaseRef = useRef("idle");
  const epochRef = useRef(0);
  const messageRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const sessionIDRef = useRef(null);
  const refreshSessionsRef = useRef(onRefreshSessions);

  useEffect(() => {
    refreshSessionsRef.current = onRefreshSessions;
  }, [onRefreshSessions]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setPhaseSafe = useCallback((nextPhase) => {
    phaseRef.current = nextPhase;
    if (mountedRef.current) setPhase(nextPhase);
  }, []);

  useEffect(() => {
    epochRef.current += 1;
    const epoch = epochRef.current;
    messageRequestRef.current += 1;
    const requestId = messageRequestRef.current;
    const controller = new AbortController();

    const sessionChanged = sessionIDRef.current !== sessionId;
    sessionIDRef.current = sessionId;

    async function load() {
      setPhaseSafe("idle");
      setActionError(null);
      setLastSubmission(null);

      if (!sessionId) {
        setMessages(initialMessages);
        return;
      }

      if (!enabled) {
        if (sessionChanged) setMessages(initialMessages);
        return;
      }

      setMessages((previous) =>
        !sessionChanged && previous.data.length > 0
          ? {
              status: "refreshing",
              data: previous.data,
              error: null,
              errorKind: null,
            }
          : { status: "loading", data: [], error: null, errorKind: null },
      );

      const result = await loadSnapshot(sessionId, controller.signal);

      if (
        controller.signal.aborted ||
        epoch !== epochRef.current ||
        requestId !== messageRequestRef.current
      ) {
        return;
      }

      if (result.messages.status === "fulfilled") {
        setMessages({
          status: "ready",
          data: result.messages.value,
          error: null,
          errorKind: null,
        });
      } else {
        const failure = connectionFailure(
          result.messages.reason,
          "Messages could not be loaded.",
        );
        setMessages({
          status: "error",
          data: [],
          error: failure.message,
          errorKind: failure.kind,
        });
      }

      if (result.statuses.status === "fulfilled") {
        const status = result.statuses.value[sessionId];
        if (statusIsBusy(status)) setPhaseSafe("working");
      }
    }

    load();

    return () => controller.abort();
  }, [enabled, sessionId, setPhaseSafe]);

  useEffect(() => {
    if (phase !== "working" || !sessionId || !enabled) {
      return undefined;
    }

    const epoch = epochRef.current;
    const controller = new AbortController();
    let stopped = false;
    let sawBusy = false;
    let idleHits = 0;
    let failures = 0;

    async function poll() {
      while (!stopped) {
        try {
          await delay(POLL_INTERVAL_MS, controller.signal);
        } catch {
          return;
        }

        if (stopped || epoch !== epochRef.current) return;

        const requestId = messageRequestRef.current + 1;
        messageRequestRef.current = requestId;
        const result = await loadSnapshot(sessionId, controller.signal);

        if (
          stopped ||
          controller.signal.aborted ||
          epoch !== epochRef.current ||
          requestId !== messageRequestRef.current
        ) {
          continue;
        }

        if (result.messages.status === "fulfilled") {
          setMessages({
            status: "ready",
            data: result.messages.value,
            error: null,
            errorKind: null,
          });
        }

        if (result.statuses.status === "fulfilled") {
          failures = 0;
          const status = result.statuses.value[sessionId];

          if (statusIsBusy(status)) {
            sawBusy = true;
            idleHits = 0;
            continue;
          }

          const settled =
            result.messages.status === "fulfilled" &&
            isConversationSettled(result.messages.value);

          if (sawBusy || settled) {
            idleHits += 1;
          } else {
            idleHits = 0;
          }

          if (idleHits >= 2) {
            setPhaseSafe("idle");
            refreshSessionsRef.current?.();
            return;
          }
        } else {
          failures += 1;
        }

        if (failures >= POLL_FAILURE_LIMIT) {
          const failure = connectionFailure(
            result.statuses.reason,
            "The conversation stopped updating.",
          );
          setActionError({ ...failure, retryable: false });
          setPhaseSafe("idle");
          refreshSessionsRef.current?.();
          return;
        }
      }
    }

    poll();

    return () => {
      stopped = true;
      controller.abort();
    };
  }, [enabled, phase, sessionId, setPhaseSafe]);

  const refresh = useCallback(async () => {
    if (!sessionId || !enabled) return false;
    if (phaseRef.current === "sending" || phaseRef.current === "stopping") {
      return false;
    }

    const requestId = messageRequestRef.current + 1;
    messageRequestRef.current = requestId;
    const epoch = epochRef.current;

    setMessages((previous) => ({
      status: previous.data.length > 0 ? "refreshing" : "loading",
      data: previous.data,
      error: null,
      errorKind: null,
    }));

    const result = await loadSnapshot(sessionId);

    if (
      epoch !== epochRef.current ||
      requestId !== messageRequestRef.current
    ) {
      return false;
    }

    if (result.messages.status === "fulfilled") {
      setMessages({
        status: "ready",
        data: result.messages.value,
        error: null,
        errorKind: null,
      });
    } else {
      const failure = connectionFailure(
        result.messages.reason,
        "Messages could not be loaded.",
      );
      setMessages((previous) => ({
        status: "error",
        data: previous.data,
        error: failure.message,
        errorKind: failure.kind,
      }));
      return false;
    }

    if (result.statuses.status === "fulfilled") {
      if (statusIsBusy(result.statuses.value[sessionId])) {
        setPhaseSafe("working");
      } else if (phaseRef.current === "working") {
        setPhaseSafe("idle");
      }
    }

    return true;
  }, [enabled, sessionId, setPhaseSafe]);

  const submit = useCallback(
    async (request) => {
      if (
        !sessionId ||
        !enabled ||
        phaseRef.current !== "idle" ||
        !request
      ) {
        return false;
      }

      const stored = { request };
      setLastSubmission(stored);
      setActionError(null);
      setPhaseSafe("sending");

      try {
        if (request.kind === "command") {
          await sendCommand(sessionId, {
            command: request.command,
            arguments: request.arguments,
            model: request.model,
            agent: request.agent,
          });
        } else {
          await sendPromptAsync(sessionId, {
            text: request.text,
            model: request.model,
            agent: request.agent,
          });
        }

        setPhaseSafe("working");
        refreshSessionsRef.current?.();
        return true;
      } catch (error) {
        const failure = actionFailure(
          error,
          request.kind === "command"
            ? "The command could not be sent."
            : "The prompt could not be sent.",
        );
        setActionError({ ...failure, retryable: true });
        setPhaseSafe("idle");
        return false;
      }
    },
    [enabled, sessionId, setPhaseSafe],
  );

  const retryLast = useCallback(() => {
    if (phaseRef.current !== "idle" || !lastSubmission) return false;
    return submit(lastSubmission.request);
  }, [lastSubmission, submit]);

  const stop = useCallback(async () => {
    if (!sessionId || !enabled || phaseRef.current !== "working") {
      return false;
    }

    setActionError(null);
    setPhaseSafe("stopping");

    try {
      await abortSession(sessionId);
      const requestId = messageRequestRef.current + 1;
      messageRequestRef.current = requestId;
      const epoch = epochRef.current;
      const result = await loadSnapshot(sessionId);

      if (
        epoch !== epochRef.current ||
        requestId !== messageRequestRef.current
      ) {
        return true;
      }

      if (result.messages.status === "fulfilled") {
        setMessages({
          status: "ready",
          data: result.messages.value,
          error: null,
          errorKind: null,
        });
      }

      if (
        result.statuses.status === "fulfilled" &&
        statusIsBusy(result.statuses.value[sessionId])
      ) {
        setPhaseSafe("working");
      } else {
        setPhaseSafe("idle");
      }

      refreshSessionsRef.current?.();
      return true;
    } catch (error) {
      setActionError({
        ...actionFailure(error, "The agent could not be stopped."),
        retryable: false,
      });
      setPhaseSafe("working");
      return false;
    }
  }, [enabled, sessionId, setPhaseSafe]);

  const clearActionError = useCallback(() => {
    setActionError(null);
  }, []);

  return {
    messages,
    phase,
    actionError,
    lastSubmission,
    refresh,
    submit,
    retryLast,
    stop,
    clearActionError,
  };
}
