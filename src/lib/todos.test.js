import assert from "node:assert/strict";
import test from "node:test";
import { orderTodos, todoIcon, todoSummary } from "./todos.js";

const TODOS = [
  { content: "Ship the feature", status: "completed", priority: "high" },
  { content: "Write tests", status: "in_progress", priority: "medium" },
  { content: "Update docs", status: "pending", priority: "low" },
  { content: "Drop it", status: "cancelled", priority: "low" },
];

test("summarizes the task list", () => {
  assert.deepEqual(todoSummary(TODOS), { total: 4, completed: 1 });
  assert.deepEqual(todoSummary(null), { total: 0, completed: 0 });
});

test("orders active work before finished work", () => {
  assert.deepEqual(
    orderTodos(TODOS).map((todo) => todo.content),
    ["Write tests", "Update docs", "Ship the feature", "Drop it"],
  );
  assert.deepEqual(orderTodos(null), []);
});

test("maps task states to icons", () => {
  assert.equal(todoIcon("completed"), "✓");
  assert.equal(todoIcon("in_progress"), "◐");
  assert.equal(todoIcon("pending"), "○");
  assert.equal(todoIcon("cancelled"), "×");
  assert.equal(todoIcon("unknown"), "○");
});
