import assert from "node:assert/strict";
import test from "node:test";
import {
  FALLBACK_PROJECT,
  PROJECT_DIRECTORY,
  normalizeProjectDirectory,
  projectLabel,
  projectPathLabel,
} from "./project.js";
import { filterSessions, isSessionArchived } from "./workspace.js";

test("normalizes only safe absolute project directories", () => {
  assert.equal(
    normalizeProjectDirectory("/data//projects/app/"),
    "/data/projects/app",
  );
  assert.equal(normalizeProjectDirectory(PROJECT_DIRECTORY), PROJECT_DIRECTORY);

  for (const value of [
    null,
    "",
    "relative/path",
    "/",
    "/tmp/../secret",
    "/tmp/./app",
    "/tmp/app\0",
    "/tmp/app\nnext",
    `/${"a".repeat(1100)}`,
  ]) {
    assert.equal(normalizeProjectDirectory(value), null);
  }
});

test("labels projects with safe names and path fallbacks", () => {
  assert.equal(projectLabel({ name: "  Mobile App  " }), "Mobile App");
  assert.equal(
    projectLabel({ worktree: "/data/projects/opencode-mobile" }),
    "opencode-mobile",
  );
  assert.equal(projectLabel(null), "Project");
  assert.equal(projectPathLabel(FALLBACK_PROJECT), PROJECT_DIRECTORY);
  assert.equal(projectPathLabel({ worktree: "relative" }), "Unknown directory");
});

test("filters sessions by title, agent, or model", () => {
  const sessions = [
    {
      id: "ses_one",
      title: "Fix keyboard",
      agent: "build",
      model: { id: "fast", providerID: "local" },
      time: { archived: 1234 },
    },
    {
      id: "ses_two",
      title: "Review changes",
      agent: "plan",
      model: { id: "big", providerID: "opencode" },
      time: {},
    },
  ];

  assert.equal(isSessionArchived(sessions[0]), true);
  assert.equal(isSessionArchived(sessions[1]), false);
  assert.equal(isSessionArchived(null), false);

  assert.deepEqual(filterSessions(sessions, ""), sessions);
  assert.deepEqual(filterSessions(sessions, " keyboard "), [sessions[0]]);
  assert.deepEqual(filterSessions(sessions, "PLAN"), [sessions[1]]);
  assert.deepEqual(filterSessions(sessions, "local"), [sessions[0]]);
  assert.deepEqual(filterSessions(sessions, "missing"), []);
  assert.deepEqual(filterSessions(null, "test"), []);
});
