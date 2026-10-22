import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { fatalCopy } from "./lib/errors.js";

const container = document.getElementById("root");

function reportFatal(error) {
  // A failure outside a React tree (for example in an event handler) would
  // otherwise leave the WebView on a blank page.
  if (typeof console !== "undefined" && console.error) {
    console.error("OpenCode Mobile hit an unrecoverable error", error);
  }

  if (!container) return;

  const copy = fatalCopy(error);

  const panel = document.createElement("div");
  panel.className = "view-error";
  panel.setAttribute("role", "alert");

  const card = document.createElement("div");
  card.className = "view-error-card";

  const kicker = document.createElement("span");
  kicker.className = "panel-kicker";
  kicker.textContent = copy.kicker;

  const title = document.createElement("h2");
  title.textContent = copy.title;

  const detail = document.createElement("p");
  detail.className = "view-error-detail";
  detail.textContent = copy.detail;

  const note = document.createElement("p");
  note.className = "panel-note";
  note.textContent = copy.note;

  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "primary-button";
  retry.textContent = "Reload";
  retry.addEventListener("click", () => window.location.reload());

  card.append(kicker, title, detail, note, retry);
  panel.append(card);
  container.replaceChildren(panel);
}

createRoot(container, {
  onUncaughtError: reportFatal,
  onCaughtError(error, errorInfo) {
    if (typeof console !== "undefined" && console.error) {
      console.error("A view could not be rendered", error, errorInfo);
    }
  },
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
