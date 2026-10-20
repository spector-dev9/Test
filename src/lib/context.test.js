import assert from "node:assert/strict";
import test from "node:test";
import {
  formatTokenCount,
  promptTokenTotal,
  summarizeSessionContext,
} from "./context.js";

const providers = {
  providers: [
    {
      id: "local",
      name: "Local",
      models: [
        {
          id: "coder",
          name: "Coder",
          limit: { context: 100000 },
        },
      ],
    },
  ],
  default: {},
};

test("summarizes only token data reported by the server", () => {
  const summary = summarizeSessionContext({
    session: { title: "Keyboard work" },
    providersData: providers,
    effectiveModel: { providerID: "local", modelID: "coder" },
    rows: [
      {
        info: { role: "user", time: { created: 10 } },
        parts: [{ type: "text", text: "Hello" }],
      },
      {
        info: {
          role: "assistant",
          providerID: "local",
          modelID: "coder",
          cost: 0.25,
          time: { created: 20, completed: 30 },
          tokens: {
            input: 1000,
            output: 200,
            reasoning: 50,
            cache: { read: 4000, write: 500 },
          },
        },
        parts: [
          { type: "text", text: "Working" },
          { type: "tool" },
          { type: "tool" },
        ],
      },
    ],
  });

  assert.equal(summary.messageCount, 2);
  assert.equal(summary.userMessages, 1);
  assert.equal(summary.assistantMessages, 1);
  assert.equal(summary.toolCalls, 2);
  assert.equal(summary.latestAt, 20);
  assert.equal(summary.tokensReported, true);
  assert.equal(summary.latestPromptTokens, 5500);
  assert.equal(summary.totalTokens, 5750);
  assert.equal(summary.cost, 0.25);
  assert.equal(summary.limit, 100000);
  assert.equal(summary.percent, 5.5);
  assert.equal(summary.model.name, "Coder");
  assert.equal(summary.sessionTitle, "Keyboard work");
});

test("never invents usage when the server omits tokens", () => {
  const summary = summarizeSessionContext({
    session: null,
    rows: [
      {
        info: { role: "assistant", time: { created: 20 } },
        parts: [{ type: "text", text: "No usage" }],
      },
    ],
    providersData: providers,
    effectiveModel: null,
  });

  assert.equal(summary.tokensReported, false);
  assert.equal(summary.latestTokens, null);
  assert.equal(summary.latestPromptTokens, 0);
  assert.equal(summary.totalTokens, 0);
  assert.equal(summary.percent, null);
  assert.equal(summary.limit, null);
  assert.equal(summary.sessionTitle, "Untitled session");
});

test("formats compact token counts and prompt totals", () => {
  assert.equal(formatTokenCount(999), "999");
  assert.equal(formatTokenCount(1500), "1.5k");
  assert.equal(formatTokenCount(15000), "15k");
  assert.equal(formatTokenCount(1_500_000), "1.5m");
  assert.equal(
    promptTokenTotal({
      input: 1,
      output: 2,
      reasoning: 3,
      cacheRead: 4,
      cacheWrite: 5,
    }),
    10,
  );
});
