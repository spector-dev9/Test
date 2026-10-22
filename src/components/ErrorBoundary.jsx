import { Component } from "react";
import { boundaryCopy, errorDetail } from "../lib/errors.js";

/**
 * Keeps a rendering failure inside one surface.
 *
 * Imported sessions and agent output are untrusted text: one malformed
 * message used to take down the whole WebView and leave a blank screen. The
 * boundary shows a recoverable panel instead, and the surrounding navigation
 * stays usable.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, key: 0 };
    this.handleRetry = this.handleRetry.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (typeof console !== "undefined" && console.error) {
      console.error("This view could not be rendered", error, info);
    }
  }

  handleRetry() {
    this.setState((previous) => ({
      error: null,
      key: previous.key + 1,
    }));
  }

  render() {
    const { error } = this.state;

    if (!error) {
      return this.props.children;
    }

    const label = this.props.label ?? "This view";
    const copy = boundaryCopy(label, error);
    const detail = errorDetail(error, copy.detail);
    const inline = this.props.variant === "inline";

    if (inline) {
      return (
        <div className="inline-error message-error" role="alert">
          <span>{detail}</span>
          <button
            type="button"
            className="text-button"
            onClick={this.handleRetry}
          >
            Try again
          </button>
        </div>
      );
    }

    return (
      <div className="view-error" role="alert">
        <div className="view-error-card">
          <span className="panel-kicker">RENDER ERROR</span>
          <h2>{copy.title}</h2>
          <p className="view-error-detail">{detail}</p>
          <p className="panel-note">{copy.note}</p>
          <div className="settings-runtime-actions">
            <button
              type="button"
              className="primary-button"
              onClick={this.handleRetry}
            >
              Try again
            </button>
            {this.props.onBack ? (
              <button
                type="button"
                className="secondary-button"
                onClick={this.props.onBack}
              >
                Back to chat
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
}
