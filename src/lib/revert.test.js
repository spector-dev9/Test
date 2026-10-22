import test from "node:test";
import assert from "node:assert/strict";
import { describeRevert } from "./revert.js";

test("describes deleting new and untracked files", () => {
  const copy = describeRevert("new.txt", "added");

  assert.equal(copy.action, "Delete file");
  assert.equal(copy.pending, "Deleting…");
  assert.equal(copy.success, "Deleted new.txt.");
  assert.match(copy.title, /new or untracked/i);
  assert.match(copy.confirmation, /Delete new\.txt\?/);
  assert.match(copy.confirmation, /working tree/);
  assert.match(copy.confirmation, /index/);
});

test("describes restoring deleted files", () => {
  const copy = describeRevert("gone.txt", "deleted");

  assert.equal(copy.action, "Restore file");
  assert.equal(copy.pending, "Restoring…");
  assert.equal(copy.success, "Restored gone.txt.");
  assert.match(copy.title, /last commit/);
  assert.match(copy.confirmation, /Restore gone\.txt\?/);
  assert.match(copy.confirmation, /deletion/);
  assert.match(copy.confirmation, /untracked file/);
});

test("describes reverting tracked modifications", () => {
  const copy = describeRevert("changed.txt", "modified");

  assert.equal(copy.action, "Revert file");
  assert.equal(copy.pending, "Reverting…");
  assert.equal(copy.success, "Reverted changed.txt.");
  assert.match(copy.title, /staged and unstaged/);
  assert.match(copy.confirmation, /staged and unstaged/);
});

test("treats untracked aliases and case variants as new files", () => {
  for (const status of ["untracked", "NEW", " Added "]) {
    assert.equal(describeRevert("new.txt", status).action, "Delete file");
  }
});

test("uses a safe fallback for unknown statuses and paths", () => {
  const copy = describeRevert(null, "renamed");

  assert.equal(copy.action, "Revert file");
  assert.match(copy.confirmation, /this file/);
  assert.match(copy.confirmation, /staged and unstaged/);
});
