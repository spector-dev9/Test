import { useMemo } from "react";
import {
  formatTokenCount,
  summarizeSessionContext,
} from "../lib/context";
import { formatSessionTime } from "../lib/workspace";
import { projectLabel, projectPathLabel } from "../lib/project";

function StatusRow({ label, value }) {
  return (
    <div className="context-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function ContextView({
  session,
  project,
  messages,
  providersData,
  effectiveModel,
  modelLabel,
  phase,
  permissions,
  connected,
  onRefresh,
  onOpenChat,
  onNewSession,
  creatingSession,
}) {
  const summary = useMemo(
    () =>
      summarizeSessionContext({
        session,
        rows: messages.data,
        providersData,
        effectiveModel,
      }),
    [effectiveModel, messages.data, providersData, session],
  );
  const percentLabel =
    summary.percent == null
      ? "Unknown"
      : `${Math.min(100, summary.percent).toFixed(1)}%`;
  const meterWidth = Math.min(100, Math.max(0, summary.percent ?? 0));
  const selectedModel = summary.model
    ? `${summary.model.name} · ${summary.model.providerID}/${summary.model.id}`
    : modelLabel;

  return (
    <section className="page-view context-view" aria-labelledby="context-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow">SESSION AWARENESS</p>
          <h1 id="context-heading">Context</h1>
          <p className="subtitle">
            Real session, model, and token data reported by your local
            OpenCode server. Nothing is estimated.
          </p>
        </div>
        <div className="context-heading-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onRefresh}
            disabled={!connected || !session}
          >
            Refresh
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={onOpenChat}
          >
            Open chat
          </button>
        </div>
      </div>

      {!session ? (
        <div className="empty-panel context-empty">
          <strong>No active session.</strong>
          <span>
            Context appears after you open or create a conversation.
          </span>
          <button
            type="button"
            className="primary-button"
            onClick={onNewSession}
            disabled={!connected || creatingSession}
          >
            ＋ {creatingSession ? "Creating…" : "New session"}
          </button>
        </div>
      ) : (
        <>
          <div className="context-grid">
            <section className="panel context-card">
              <span className="panel-kicker">SESSION</span>
              <h2>{summary.sessionTitle}</h2>
              <div className="context-rows">
                <StatusRow
                  label="Project"
                  value={project ? projectLabel(project) : "This project"}
                />
                <StatusRow label="Model" value={selectedModel} />
                <StatusRow
                  label="Status"
                  value={
                    phase === "working"
                      ? "Agent working"
                      : phase === "sending"
                        ? "Sending prompt"
                        : phase === "stopping"
                          ? "Stopping"
                          : "Idle"
                  }
                />
                <StatusRow
                  label="Updated"
                  value={
                    summary.latestAt
                      ? formatSessionTime(summary.latestAt)
                      : formatSessionTime(session.time?.updated)
                  }
                />
              </div>
            </section>

            <section className="panel context-card">
              <span className="panel-kicker">CONVERSATION</span>
              <h2>{summary.messageCount} messages</h2>
              <div className="context-rows">
                <StatusRow
                  label="From you"
                  value={summary.userMessages.toLocaleString()}
                />
                <StatusRow
                  label="From agent"
                  value={summary.assistantMessages.toLocaleString()}
                />
                <StatusRow
                  label="Tool calls"
                  value={summary.toolCalls.toLocaleString()}
                />
                <StatusRow
                  label="Permissions"
                  value={
                    permissions.length > 0
                      ? `${permissions.length} pending`
                      : "None pending"
                  }
                />
              </div>
            </section>
          </div>

          <section className="panel context-card context-usage-card">
            <div className="context-usage-head">
              <div>
                <span className="panel-kicker">LATEST PROMPT</span>
                <h2>
                  {summary.tokensReported
                    ? `${formatTokenCount(summary.latestPromptTokens)} ${
                        summary.limit
                          ? `of ${formatTokenCount(summary.limit)}`
                          : "tokens"
                      }`
                    : "Usage not reported yet"}
                </h2>
              </div>
              <span className="context-percent">{percentLabel}</span>
            </div>

            {summary.limit && summary.tokensReported ? (
              <div
                className="context-meter"
                role="img"
                aria-label={`${percentLabel} of the reported model context limit`}
              >
                <span style={{ width: `${meterWidth}%` }} />
              </div>
            ) : null}

            {summary.tokensReported ? (
              <>
                <dl className="token-breakdown">
                  <div>
                    <dt>Input</dt>
                    <dd>{summary.latestTokens.input.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Output</dt>
                    <dd>{summary.latestTokens.output.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Reasoning</dt>
                    <dd>{summary.latestTokens.reasoning.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Cache read</dt>
                    <dd>
                      {summary.latestTokens.cacheRead.toLocaleString()}
                    </dd>
                  </div>
                  <div>
                    <dt>Cache write</dt>
                    <dd>
                      {summary.latestTokens.cacheWrite.toLocaleString()}
                    </dd>
                  </div>
                  <div>
                    <dt>Session cost</dt>
                    <dd>
                      {summary.cost > 0
                        ? `$${summary.cost.toFixed(4)}`
                        : "Not reported / free"}
                    </dd>
                  </div>
                </dl>
                <p className="panel-note">
                  Latest prompt usage comes from the most recent assistant
                  message that reported token usage. Session totals are the sum
                  of reported assistant turns, not a live context-window
                  measurement.
                </p>
              </>
            ) : (
              <p className="panel-note">
                Send a prompt and wait for a completed assistant response. This
                server version only exposes usage after the provider reports it.
              </p>
            )}
          </section>

          <section className="panel context-card">
            <span className="panel-kicker">WORKSPACE SCOPE</span>
            <h2>{project ? projectLabel(project) : "This project"}</h2>
            <p className="context-path">
              {project ? projectPathLabel(project) : "Project directory"}
            </p>
            <p className="panel-note">
              File, session, and context requests are scoped to this directory
              and validated by the native transport. System-prompt token
              categories are not exposed by the server, so they are not shown.
            </p>
          </section>
        </>
      )}
    </section>
  );
}
