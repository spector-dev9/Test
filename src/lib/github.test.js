import assert from "node:assert/strict";
import test from "node:test";
import { joinWorkspacePath, parseRepositoryUrl } from "./github.js";
import { PROJECT_DIRECTORY } from "./project.js";

test("parses HTTPS repository URLs", () => {
  assert.deepEqual(
    parseRepositoryUrl(" https://github.com/octocat/Hello-World.git "),
    {
      ok: true,
      url: "https://github.com/octocat/Hello-World.git",
      owner: "octocat",
      name: "Hello-World",
      label: "octocat/Hello-World",
    },
  );

  assert.deepEqual(
    parseRepositoryUrl("https://github.example.com/team/repo"),
    {
      ok: true,
      url: "https://github.example.com/team/repo",
      owner: "team",
      name: "repo",
      label: "team/repo",
    },
  );
});

test("rejects unsafe repository URLs", () => {
  for (const value of [
    "",
    "github.com/octocat/Hello-World",
    "http://github.com/octocat/Hello-World",
    "https://user:token@github.com/octocat/Hello-World",
    "https://github.com/octocat/Hello-World?token=secret",
    "https://github.com/octocat",
    "https://github.com/bad owner/repo",
    "https://github.com/owner/..",
  ]) {
    assert.equal(parseRepositoryUrl(value).ok, false);
  }
});

test("joins a repository name inside the workspace only", () => {
  assert.equal(
    joinWorkspacePath(PROJECT_DIRECTORY, "Hello-World"),
    `${PROJECT_DIRECTORY}/Hello-World`,
  );
  assert.equal(joinWorkspacePath(PROJECT_DIRECTORY, "../escape"), null);
  assert.equal(joinWorkspacePath(PROJECT_DIRECTORY, "a/b"), null);
  assert.equal(joinWorkspacePath("relative", "repo"), null);
  assert.equal(joinWorkspacePath("/", "repo"), null);
});
