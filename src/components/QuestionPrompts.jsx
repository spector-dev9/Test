import { useMemo, useState } from "react";

function answerLabels(question, selected, custom) {
  const labels = Array.isArray(selected) ? selected : [];
  const customLabel = typeof custom === "string" ? custom.trim() : "";

  if (!question.multiple) {
    return customLabel ? [customLabel] : labels.slice(0, 1);
  }

  return [...new Set([...labels, ...(customLabel ? [customLabel] : [])])];
}

export function QuestionPrompts({
  questions,
  onReply,
  onReject,
  busyId,
  error,
}) {
  const request = questions[0];
  const [selected, setSelected] = useState({});
  const [custom, setCustom] = useState({});

  const answers = useMemo(() => {
    if (!request) return [];
    return request.questions.map((question, index) =>
      answerLabels(question, selected[index], custom[index]),
    );
  }, [custom, request, selected]);

  if (!request) return null;

  const busy = busyId === request.id;
  const complete = answers.every((labels) => labels.length > 0);

  function toggleOption(index, question, label) {
    if (!question.multiple) {
      setCustom((values) => ({ ...values, [index]: "" }));
    }

    setSelected((previous) => {
      const current = previous[index] ?? [];

      if (question.multiple) {
        const next = current.includes(label)
          ? current.filter((value) => value !== label)
          : [...current, label];
        return { ...previous, [index]: next };
      }

      return {
        ...previous,
        [index]: current.includes(label) ? [] : [label],
      };
    });
  }

  function updateCustom(index, question, value) {
    setCustom((previous) => ({ ...previous, [index]: value }));

    if (!question.multiple) {
      setSelected((previous) => ({ ...previous, [index]: [] }));
    }
  }

  return (
    <div className="question-backdrop">
      <section
        className="question-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="question-dialog-title"
      >
        <div className="question-dialog-head">
          <div>
            <span className="panel-kicker">QUESTION</span>
            <h2 id="question-dialog-title">
              {request.questions.length === 1
                ? request.questions[0].header
                : "The agent needs your input"}
            </h2>
          </div>
          {questions.length > 1 ? (
            <span className="question-count">
              1 of {questions.length}
            </span>
          ) : null}
        </div>

        {error ? (
          <div className="inline-error question-error" role="alert">
            {error}
          </div>
        ) : null}

        <div className="question-list">
          {request.questions.map((question, index) => {
            const selectedLabels = selected[index] ?? [];
            const showCustom =
              question.custom === true || question.options.length === 0;

            return (
              <fieldset className="question-item" key={`${question.header}-${index}`}>
                <legend>{question.question}</legend>
                {question.multiple ? (
                  <p className="question-hint">Select all that apply.</p>
                ) : null}

                {question.options.length > 0 ? (
                  <div className="question-options">
                    {question.options.map((option) => {
                      const active = selectedLabels.includes(option.label);
                      return (
                        <button
                          type="button"
                          className={`question-option${active ? " selected" : ""}`}
                          key={option.label}
                          aria-pressed={active}
                          onClick={() =>
                            toggleOption(index, question, option.label)
                          }
                          disabled={busy}
                        >
                          <span className="question-option-label">
                            {option.label}
                          </span>
                          {option.description ? (
                            <span className="question-option-description">
                              {option.description}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {showCustom ? (
                  <label className="question-custom">
                    <span>
                      {question.options.length > 0
                        ? "Or type your own answer"
                        : "Your answer"}
                    </span>
                    <input
                      value={custom[index] ?? ""}
                      onChange={(event) =>
                        updateCustom(index, question, event.target.value)
                      }
                      maxLength={500}
                      disabled={busy}
                      autoCapitalize="sentences"
                    />
                  </label>
                ) : null}
              </fieldset>
            );
          })}
        </div>

        <div className="question-actions">
          <button
            type="button"
            className="danger-button"
            onClick={() => onReject(request.id)}
            disabled={busy}
          >
            Reject
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => onReply(request.id, answers)}
            disabled={busy || !complete}
          >
            {busy ? "Sending…" : "Send answer"}
          </button>
        </div>
      </section>
    </div>
  );
}
