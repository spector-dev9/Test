import { isValidViewId } from "./views.js";

const VIEW_STORAGE_KEY = "opencode-mobile.active-view";
const SESSION_STORAGE_KEY = "opencode-mobile.selected-session";

export function readStoredActiveView() {
  if (typeof window === "undefined") return "chat";

  try {
    const value = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return isValidViewId(value) ? value : "chat";
  } catch {
    return "chat";
  }
}

export function storeActiveView(view) {
  if (typeof window === "undefined") return;

  try {
    if (view && isValidViewId(view)) {
      window.localStorage.setItem(VIEW_STORAGE_KEY, view);
    }
  } catch {
    return;
  }
}

export function readStoredSessionId() {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(SESSION_STORAGE_KEY);
    return typeof value === "string" && value.length > 0 && value.length <= 200
      ? value
      : null;
  } catch {
    return null;
  }
}

export function storeSessionId(sessionId) {
  if (typeof window === "undefined") return;

  try {
    if (sessionId) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    } else {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    return;
  }
}
