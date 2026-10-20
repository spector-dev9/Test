import { useMemo } from "react";
import {
  formatModelLabel,
  normalizeProviders,
} from "../lib/workspace";

function capabilityLabels(model) {
  const labels = [];
  if (model.capabilities?.toolcall) labels.push("tools");
  if (model.capabilities?.reasoning) labels.push("reasoning");
  if (model.capabilities?.input?.image) labels.push("images");
  return labels;
}

function sameModel(left, right) {
  return (
    left?.providerID === right?.providerID &&
    left?.modelID === right?.modelID
  );
}

export function ModelsView({
  models,
  preferredModel,
  effectiveModel,
  onSelectModel,
  onRefresh,
  connected,
}) {
  const normalized = useMemo(
    () => normalizeProviders(models.data),
    [models.data],
  );
  const activeModel = preferredModel ?? effectiveModel;

  return (
    <section className="page-view" aria-labelledby="models-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow">WORKSPACE</p>
          <h1 id="models-heading">Models</h1>
          <p className="subtitle">
            Choose the model used for new prompts and sessions.
          </p>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={onRefresh}
          disabled={!connected || models.status === "refreshing"}
        >
          Refresh
        </button>
      </div>

      <div className="panel model-summary">
        <div>
          <span className="panel-kicker">CURRENT SELECTION</span>
          <strong>{formatModelLabel(activeModel, models.data)}</strong>
        </div>
        <p>
          The server still enforces provider access and model limits. Changing
          this setting only affects prompts sent from this app.
        </p>
      </div>

      {models.status === "loading" ? (
        <div className="model-grid" aria-hidden="true">
          <span className="model-skeleton" />
          <span className="model-skeleton" />
          <span className="model-skeleton" />
        </div>
      ) : null}

      {models.status === "error" ? (
        <div className="inline-error page-error" role="alert">
          <span>{models.error || "Models could not be loaded."}</span>
          <button
            type="button"
            className="text-button"
            onClick={onRefresh}
            disabled={!connected}
          >
            Retry
          </button>
        </div>
      ) : null}

      {models.status === "offline" ? (
        <div className="empty-panel">
          <strong>Models are unavailable while the server is offline.</strong>
          <span>Reconnect, then refresh this view.</span>
        </div>
      ) : null}

      {normalized.providers.length > 0 ? (
        <div className="provider-list">
          {normalized.providers.map((provider) => (
            <section className="provider-section" key={provider.id}>
              <div className="provider-heading">
                <h2>{provider.name}</h2>
                <span>{provider.models.length} models</span>
              </div>
              <div className="model-grid">
                {provider.models.map((model) => {
                  const selection = {
                    providerID: provider.id,
                    modelID: model.id,
                  };
                  const selected = sameModel(activeModel, selection);
                  const labels = capabilityLabels(model);

                  return (
                    <button
                      type="button"
                      key={model.id}
                      className={`model-card${selected ? " selected" : ""}`}
                      aria-pressed={selected}
                      onClick={() => onSelectModel(selection)}
                    >
                      <span className="model-card-head">
                        <span className="model-name">{model.name}</span>
                        <span className="model-check">
                          {selected ? "✓" : ""}
                        </span>
                      </span>
                      <span className="model-id">{model.id}</span>
                      <span className="model-meta">
                        <span>
                          {model.limit?.context
                            ? `${Math.round(model.limit.context / 1000)}k context`
                            : "context unknown"}
                        </span>
                        <span>{model.status || "active"}</span>
                      </span>
                      {labels.length > 0 ? (
                        <span className="model-capabilities">
                          {labels.map((label) => (
                            <span key={label}>{label}</span>
                          ))}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {models.status === "ready" &&
      normalized.providers.length === 0 ? (
        <div className="empty-panel">
          <strong>No configured models were returned.</strong>
          <span>Check the server's provider configuration.</span>
        </div>
      ) : null}
    </section>
  );
}
