export const BACK_ACTIONS = Object.freeze({
  CLOSE_MENU: "close-menu",
  NONE: "none",
  DISMISS_MODAL: "dismiss-modal",
  EXIT_FULLSCREEN: "exit-fullscreen",
  NAVIGATE_BACK: "navigate-back",
  CLEAR_DRAFT: "clear-draft",
  EXIT_APP: "exit-app",
});

/**
 * Decide what the Android back gesture should do.
 *
 * The order matters: an open menu or modal always wins, an expanded
 * fullscreen surface is restored before the app navigates, and only a chat
 * view with an empty composer leaves the app.
 */
export function resolveBackAction({
  menuOpen = false,
  serverGateVisible = false,
  modalOpen = false,
  fullscreen = false,
  activeView = "chat",
  hasDraft = false,
} = {}) {
  if (menuOpen) return BACK_ACTIONS.CLOSE_MENU;
  if (serverGateVisible) return BACK_ACTIONS.NONE;
  if (modalOpen) return BACK_ACTIONS.DISMISS_MODAL;
  if (fullscreen) return BACK_ACTIONS.EXIT_FULLSCREEN;
  if (activeView !== "chat") return BACK_ACTIONS.NAVIGATE_BACK;
  if (hasDraft) return BACK_ACTIONS.CLEAR_DRAFT;
  return BACK_ACTIONS.EXIT_APP;
}

export function previousView(history, current) {
  if (!Array.isArray(history)) return null;

  let index = history.length;

  while (index > 0) {
    index -= 1;
    const candidate = history[index];
    if (candidate && candidate !== current) return candidate;
  }

  return null;
}
