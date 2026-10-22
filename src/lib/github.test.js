import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidBranchName,
  joinWorkspacePath,
  parseRemoteUrl,
  parseRepositoryUrl,
  revertRepositoryFile,
} from "./github.js";
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

test("requires the native app for file reversion", async () => {
  await assert.rejects(
    revertRepositoryFile({
      directory: PROJECT_DIRECTORY,
      path: "src/a.js",
    }),
    /only available in the Android app/,
  );
});

test("validates branch names for the local git runtime", () => {
  assert.equal(isValidBranchName("main"), true);
  assert.equal(isValidBranchName("feature/new-ui"), true);
  assert.equal(isValidBranchName("release-1.2"), true);
  assert.equal(isValidBranchName(""), false);
  assert.equal(isValidBranchName("  "), false);
  assert.equal(isValidBranchName("bad branch"), false);
  assert.equal(isValidBranchName("../escape"), false);
  assert.equal(isValidBranchName("/leading"), false);
  assert.equal(isValidBranchName("trailing/"), false);
  assert.equal(isValidBranchName(null), false);
});

test("validates remote addresses for the local git runtime", () => {
  assert.deepEqual(parseRemoteUrl(" https://github.com/owner/repo "), {
    ok: true,
    url: "https://github.com/owner/repo",
  });

  for (const value of [
    "",
    "github.com/owner/repo",
    "http://github.com/owner/repo",
    "https://token@github.com/owner/repo",
    "https://github.com/owner",
    "https://github.com/owner/repo?x=1",
  ]) {
    assert.equal(parseRemoteUrl(value).ok, false, value);
  }
});
