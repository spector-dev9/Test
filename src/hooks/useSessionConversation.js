import { useCallback, useEffect, useRef, useState } from "react";
import { connectionFailure } from "../lib/connection";
import {
  abortSession,
  getSessionStatuses,
  listPermissions,
  listQuestions,
  listSessionMessages,
  listSessionTodos,
  rejectQuestion as rejectQuestionRequest,
  replyPermission,
  replyQuestion,
  sendCommand,
  sendPromptAsync,
} from "../lib/opencode";
import {
  isConversationSettled,
  normalizeConversation,
} from "../lib/workspace";

const initialMessages = {
  status: "idle",
  data: [],
  error: null,
  errorKind: null,
};

const POLL_INTERVAL_MS = 1600;
const HIDDEN_POLL_INTERVAL_MS = 5000;
const IDLE_CONFIRMATIONS = 2;
const SUBMIT_GRACE_MS = 5000;
const POLL_FAILURE_LIMIT = 3;

function isVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function textSignature(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return `${value.length}:${hash >>> 0}`;
}

const signatureCache = new WeakMap();
const listSignatureCache = new WeakMap();

function listSignature(rows) {
  if (!Array.isArray(rows)) return "";
  const cached = listSignatureCache.get(rows);
  if (cached !== undefined) return cached;

  const signature = JSON.stringify(rows);
  listSignatureCache.set(rows, signature);
  return signature;
}

function applyList(setValue, rows) {
  const signature = listSignature(rows);

  setValue((previous) => {
    if (Array.isArray(previous) && listSignature(previous) === signature) {
      return previous;
    }

    return rows;
  });
}

function messageSignature(rows) {
  if (!Array.isArray(rows)) return "";

  return rows
    .map((row) => {
      const text = typeof row?.text === "string" ? row.text : "";
      const tools = Array.isArray(row?.tools) ? row.tools : [];
      const attachments = Array.isArray(row?.attachments)
        ? row.attachments.map((attachment) =>
            [attachment?.filename ?? "", attachment?.mime ?? ""].join(":"),
          )
        : [];

      return [
        row?.id ?? "",
        row?.role ?? "",
        row?.model ?? "",
        row?.created ?? "",
        row?.completed ? "1" : "0",
        textSignature(text),
        attachments.join(","),
        row?.error ?? "",
        ...tools.map((tool) =>
          [
            tool?.id ?? "",
            tool?.name ?? "",
            tool?.status ?? "",
            tool?.title ?? "",
            tool?.detail ?? "",
          ].join(":"),
        ),
      ].join("|");
    })
    .join("\n");
}

function rowsSignature(rows) {
  if (!Array.isArray(rows)) return "";
  const cached = signatureCache.get(rows);
  if (cached !== undefined) return cached;

  const signature = messageSignature(normalizeConversation(rows));
  signatureCache.set(rows, signature);
  return signature;
}

function applyMessageRows(setMessages, rows) {
  const signature = rowsSignature(rows);

  setMessages((previous) => {
    if (
      previous.status === "ready" &&
      rowsSignature(previous.data) === signature
    ) {
      return previous;
    }

    return {
      status: "ready",
      data: rows,
      error: null,
      errorKind: null,
    };
  });
}

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

function permissionsForSession(rows, sessionID) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((request) => request?.sessionID === sessionID);
}

function questionsForSession(rows, sessionID) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((request) => request?.sessionID === sessionID);
}

async function loadSnapshot(directory, sessionID, signal) {
  const [messages, statuses, permissions, questions, todos] =
    await Promise.allSettled([
      listSessionMessages(directory, sessionID, signal),
      getSessionStatuses(directory, signal),
      listPermissions(directory, signal),
      listQuestions(directory, signal),
      listSessionTodos(directory, sessionID, signal),
    ]);

  return { messages, statuses, permissions, questions, todos };
}

function applyQuestionResult(result, sessionID, setQuestions, setError) {
  if (result.questions.status === "fulfilled") {
    applyList(
      setQuestions,
      questionsForSession(result.questions.value, sessionID),
    );
    setError(null);
  } else {
    setError("Questions could not be loaded.");
  }
}

function applyTodoResult(result, setTodos, setError) {
  if (result.todos.status === "fulfilled") {
    applyList(setTodos, result.todos.value);
    setError(null);
  } else {
    setError("The todo list could not be loaded.");
  }
}

export function useSessionConversation({
  directory,
  sessionId,
  enabled,
  onRefreshSessions,
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [phase, setPhase] = useState("idle");
  const [actionError, setActionError] = useState(null);
  const [lastSubmission, setLastSubmission] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [permissionError, setPermissionError] = useState(null);
  const [replyingPermissionId, setReplyingPermissionId] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [questionError, setQuestionError] = useState(null);
  const [answeringQuestionId, setAnsweringQuestionId] = useState(null);
  const [todos, setTodos] = useState([]);
  const [todoError, setTodoError] = useState(null);
  const phaseRef = useRef("idle");
  const epochRef = useRef(0);
  const messageRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const sessionIDRef = useRef(null);
  const directoryRef = useRef(null);
  const submittedAtRef = useRef(0);
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

    const connectionChanged =
      directoryRef.current !== directory ||
      sessionIDRef.current !== sessionId;
    sessionIDRef.current = sessionId;
    directoryRef.current = directory;

    async function load() {
      setPhaseSafe("idle");
      setActionError(null);
      setLastSubmission(null);
      setPermissionError(null);
      setReplyingPermissionId(null);
      setQuestionError(null);
      setAnsweringQuestionId(null);
      setTodoError(null);
      submittedAtRef.current = 0;

      if (!sessionId || !directory) {
        setMessages(initialMessages);
        setPermissions([]);
        setQuestions([]);
        setTodos([]);
        return;
      }

      if (!enabled) {
        if (connectionChanged) {
          setMessages(initialMessages);
          setPermissions([]);
          setQuestions([]);
          setTodos([]);
        }
        return;
      }

      setMessages((previous) =>
        !connectionChanged && previous.data.length > 0
          ? {
              status: "refreshing",
              data: previous.data,
              error: null,
              errorKind: null,
            }
          : { status: "loading", data: [], error: null, errorKind: null },
      );

      const result = await loadSnapshot(
        directory,
        sessionId,
        controller.signal,
      );

      if (
        controller.signal.aborted ||
        epoch !== epochRef.current ||
        requestId !== messageRequestRef.current
      ) {
        return;
      }

      if (result.messages.status === "fulfilled") {
        applyMessageRows(setMessages, result.messages.value);
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

      if (result.permissions.status === "fulfilled") {
        applyList(
          setPermissions,
          permissionsForSession(result.permissions.value, sessionId),
        );
      }

      applyQuestionResult(
        result,
        sessionId,
        setQuestions,
        setQuestionError,
      );
      applyTodoResult(result, setTodos, setTodoError);
    }

    load();

    return () => controller.abort();
  }, [directory, enabled, sessionId, setPhaseSafe]);

  useEffect(() => {
    if (phase !== "working" || !sessionId || !directory || !enabled) {
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
          await delay(
            isVisible() ? POLL_INTERVAL_MS : HIDDEN_POLL_INTERVAL_MS,
            controller.signal,
          );
        } catch {
          return;
        }

        if (stopped || epoch !== epochRef.current) return;
        if (!isVisible()) continue;

        const requestId = messageRequestRef.current + 1;
        messageRequestRef.current = requestId;
        const result = await loadSnapshot(
          directory,
          sessionId,
          controller.signal,
        );

        if (
          stopped ||
          controller.signal.aborted ||
          epoch !== epochRef.current ||
          requestId !== messageRequestRef.current
        ) {
          continue;
        }

        if (result.messages.status === "fulfilled") {
          applyMessageRows(setMessages, result.messages.value);
        }

        if (result.permissions.status === "fulfilled") {
          applyList(
            setPermissions,
            permissionsForSession(result.permissions.value, sessionId),
          );
        }

        applyQuestionResult(
          result,
          sessionId,
          setQuestions,
          setQuestionError,
        );
        applyTodoResult(result, setTodos, setTodoError);

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
          const submitAge = Date.now() - submittedAtRef.current;
          const trustedIdle =
            sawBusy || submitAge >= SUBMIT_GRACE_MS || settled;

          if (trustedIdle) {
            idleHits += 1;
          } else {
            idleHits = 0;
          }

          if (idleHits >= IDLE_CONFIRMATIONS) {
            setPhaseSafe("idle");
            submittedAtRef.current = 0;
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
          submittedAtRef.current = 0;
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
  }, [directory, enabled, phase, sessionId, setPhaseSafe]);

  const refresh = useCallback(async () => {
    if (!directory || !sessionId || !enabled) return false;
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

    const result = await loadSnapshot(directory, sessionId);

    if (
      epoch !== epochRef.current ||
      requestId !== messageRequestRef.current
    ) {
      return false;
    }

    if (result.messages.status === "fulfilled") {
      applyMessageRows(setMessages, result.messages.value);
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

    if (result.permissions.status === "fulfilled") {
      applyList(
        setPermissions,
        permissionsForSession(result.permissions.value, sessionId),
      );
    }

    applyQuestionResult(
      result,
      sessionId,
      setQuestions,
      setQuestionError,
    );
    applyTodoResult(result, setTodos, setTodoError);

    if (result.statuses.status === "fulfilled") {
      if (statusIsBusy(result.statuses.value[sessionId])) {
        setPhaseSafe("working");
      } else if (phaseRef.current === "working") {
        setPhaseSafe("idle");
      }
    }

    return true;
  }, [directory, enabled, sessionId, setPhaseSafe]);

  const submit = useCallback(
    async (request) => {
      if (
        !directory ||
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
      submittedAtRef.current = Date.now();
      setPhaseSafe("sending");

      try {
        if (request.kind === "command") {
          await sendCommand(directory, sessionId, {
            command: request.command,
            arguments: request.arguments,
            model: request.model,
            agent: request.agent,
          });
        } else {
          await sendPromptAsync(directory, sessionId, {
            text: request.text,
            model: request.model,
            agent: request.agent,
            attachments: request.attachments,
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
        submittedAtRef.current = 0;
        setActionError({ ...failure, retryable: true });
        setPhaseSafe("idle");
        return false;
      }
    },
    [directory, enabled, sessionId, setPhaseSafe],
  );

  const retryLast = useCallback(() => {
    if (phaseRef.current !== "idle" || !lastSubmission) return false;
    return submit(lastSubmission.request);
  }, [lastSubmission, submit]);

  const stop = useCallback(async () => {
    if (
      !directory ||
      !sessionId ||
      !enabled ||
      phaseRef.current !== "working"
    ) {
      return false;
    }

    setActionError(null);
    setPhaseSafe("stopping");

    try {
      await abortSession(directory, sessionId);
      const requestId = messageRequestRef.current + 1;
      messageRequestRef.current = requestId;
      const epoch = epochRef.current;
      const result = await loadSnapshot(directory, sessionId);

      if (
        epoch !== epochRef.current ||
        requestId !== messageRequestRef.current
      ) {
        return true;
      }

      if (result.messages.status === "fulfilled") {
        applyMessageRows(setMessages, result.messages.value);
      }

      if (result.permissions.status === "fulfilled") {
        applyList(
          setPermissions,
          permissionsForSession(result.permissions.value, sessionId),
        );
      }

      applyQuestionResult(
        result,
        sessionId,
        setQuestions,
        setQuestionError,
      );
      applyTodoResult(result, setTodos, setTodoError);

      if (
        result.statuses.status === "fulfilled" &&
        statusIsBusy(result.statuses.value[sessionId])
      ) {
        setPhaseSafe("working");
      } else {
        setPhaseSafe("idle");
        submittedAtRef.current = 0;
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
  }, [directory, enabled, sessionId, setPhaseSafe]);

  const respondToPermission = useCallback(
    async (requestID, reply, message) => {
      if (!directory || !sessionId || !enabled) return false;

      setPermissionError(null);
      setReplyingPermissionId(requestID);

      try {
        await replyPermission(directory, requestID, { reply, message });

        const result = await loadSnapshot(directory, sessionId);

        if (result.messages.status === "fulfilled") {
          applyMessageRows(setMessages, result.messages.value);
        }

        if (result.permissions.status === "fulfilled") {
          applyList(
            setPermissions,
            permissionsForSession(result.permissions.value, sessionId),
          );
        } else {
          setPermissions((previous) =>
            previous.filter((request) => request.id !== requestID),
          );
        }

        if (result.statuses.status === "fulfilled") {
          if (statusIsBusy(result.statuses.value[sessionId])) {
            setPhaseSafe("working");
          }
        }

        refreshSessionsRef.current?.();
        return true;
      } catch (error) {
        const failure = connectionFailure(
          error,
          "The permission response could not be sent.",
        );
        setPermissionError(failure.message);
        return false;
      } finally {
        setReplyingPermissionId(null);
      }
    },
    [directory, enabled, sessionId, setPhaseSafe],
  );

  const respondToQuestion = useCallback(
    async (requestID, answers) => {
      if (!directory || !sessionId || !enabled) return false;

      setQuestionError(null);
      setAnsweringQuestionId(requestID);

      try {
        await replyQuestion(directory, requestID, answers);

        const result = await loadSnapshot(directory, sessionId);

        if (result.messages.status === "fulfilled") {
          applyMessageRows(setMessages, result.messages.value);
        }

        applyQuestionResult(
          result,
          sessionId,
          setQuestions,
          setQuestionError,
        );
        setQuestions((previous) =>
          previous.filter((question) => question.id !== requestID),
        );
        setQuestionError(null);
        applyTodoResult(result, setTodos, setTodoError);

        if (
          result.statuses.status === "fulfilled" &&
          statusIsBusy(result.statuses.value[sessionId])
        ) {
          setPhaseSafe("working");
        }

        refreshSessionsRef.current?.();
        return true;
      } catch (error) {
        const failure = connectionFailure(
          error,
          "The question response could not be sent.",
        );
        setQuestionError(failure.message);
        return false;
      } finally {
        setAnsweringQuestionId(null);
      }
    },
    [directory, enabled, sessionId, setPhaseSafe],
  );

  const rejectQuestion = useCallback(
    async (requestID) => {
      if (!directory || !sessionId || !enabled) return false;

      setQuestionError(null);
      setAnsweringQuestionId(requestID);

      try {
        await rejectQuestionRequest(directory, requestID);

        const result = await loadSnapshot(directory, sessionId);

        if (result.messages.status === "fulfilled") {
          applyMessageRows(setMessages, result.messages.value);
        }

        applyQuestionResult(
          result,
          sessionId,
          setQuestions,
          setQuestionError,
        );
        setQuestions((previous) =>
          previous.filter((question) => question.id !== requestID),
        );
        setQuestionError(null);
        applyTodoResult(result, setTodos, setTodoError);

        if (
          result.statuses.status === "fulfilled" &&
          statusIsBusy(result.statuses.value[sessionId])
        ) {
          setPhaseSafe("working");
        }

        refreshSessionsRef.current?.();
        return true;
      } catch (error) {
        const failure = connectionFailure(
          error,
          "The question could not be rejected.",
        );
        setQuestionError(failure.message);
        return false;
      } finally {
        setAnsweringQuestionId(null);
      }
    },
    [directory, enabled, sessionId, setPhaseSafe],
  );

  const clearActionError = useCallback(() => {
    setActionError(null);
  }, []);

  return {
    messages,
    phase,
    actionError,
    lastSubmission,
    permissions,
    permissionError,
    replyingPermissionId,
    questions,
    questionError,
    answeringQuestionId,
    todos,
    todoError,
    refresh,
    submit,
    retryLast,
    stop,
    respondToPermission,
    respondToQuestion,
    rejectQuestion,
    clearActionError,
  };
}
