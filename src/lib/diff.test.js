import assert from "node:assert/strict";
import test from "node:test";
import { parseUnifiedPatch, summarizePatchStats } from "./diff.js";

const TWO_HUNKS = [
  "diff --git a/f.txt b/f.txt",
  "--- a/f.txt",
  "+++ b/f.txt",
  "@@ -1,4 +1,4 @@",
  " context1",
  "-old2",
  "+new2",
  " context3",
  " context4",
  "@@ -20,3 +20,4 @@",
  " tail1",
  "+added",
  " tail2",
  " tail3",
].join("\n");

test("parses multiple hunks with line numbers and row kinds", () => {
  const hunks = parseUnifiedPatch(TWO_HUNKS);

  assert.equal(hunks.length, 2);

  const [first, second] = hunks;

  assert.equal(first.oldStart, 1);
  assert.equal(first.newStart, 1);
  assert.deepEqual(
    first.rows.map((row) => row.kind),
    ["context", "change", "context", "context"],
  );

  const change = first.rows[1];
  assert.equal(change.left.no, 2);
  assert.equal(change.left.text, "old2");
  assert.equal(change.right.no, 2);
  assert.equal(change.right.text, "new2");

  assert.equal(second.oldStart, 20);
  assert.equal(second.newStart, 20);
  assert.deepEqual(
    second.rows.map((row) => row.kind),
    ["context", "add", "context", "context"],
  );

  const added = second.rows[1];
  assert.equal(added.left, null);
  assert.equal(added.right.no, 21);
  assert.equal(added.right.text, "added");
});

test("summarizes additions and deletions including changes", () => {
  const stats = summarizePatchStats(parseUnifiedPatch(TWO_HUNKS));
  assert.deepEqual(stats, { additions: 2, deletions: 1 });

  const patch = [
    "--- a/g.txt",
    "+++ b/g.txt",
    "@@ -5,2 +5,2 @@",
    "-gone",
    "+fresh",
    " keep",
  ].join("\n");

  assert.deepEqual(summarizePatchStats(parseUnifiedPatch(patch)), {
    additions: 1,
    deletions: 1,
  });
});

test("tolerates empty lines and unprefixed context", () => {
  const patch = [
    "@@ -1,3 +1,3 @@",
    "plain context",
    "",
    "-removed",
  ].join("\n");

  const [hunk] = parseUnifiedPatch(patch);
  assert.equal(hunk.rows.length, 3);
  assert.deepEqual(
    hunk.rows.map((row) => row.kind),
    ["context", "context", "remove"],
  );
  assert.equal(hunk.rows[1].left.text, "");
});

test("pairs uneven change blocks and skips newline markers", () => {
  const patch = [
    "@@ -1,3 +1,2 @@",
    "-one",
    "-two",
    "+only",
    "\\ No newline at end of file",
    " tail",
  ].join("\n");

  const [hunk] = parseUnifiedPatch(patch);
  assert.deepEqual(
    hunk.rows.map((row) => row.kind),
    ["change", "remove", "context"],
  );
  assert.equal(hunk.rows[0].right.text, "only");
  assert.equal(hunk.rows[1].left.text, "two");
});

test("returns no hunks for empty or non-patch input", () => {
  assert.deepEqual(parseUnifiedPatch(""), []);
  assert.deepEqual(parseUnifiedPatch(null), []);
  assert.deepEqual(parseUnifiedPatch(42), []);
  assert.deepEqual(parseUnifiedPatch("just some text\nno hunks here"), []);
  assert.deepEqual(summarizePatchStats([]), { additions: 0, deletions: 0 });
  assert.deepEqual(summarizePatchStats("not-an-array"), {
    additions: 0,
    deletions: 0,
  });
});

test("captures hunk trailing context", () => {
  const patch = "@@ -1,1 +1,1 @@ function main()";
  const [hunk] = parseUnifiedPatch(patch);
  assert.equal(hunk.context, "function main()");
});
