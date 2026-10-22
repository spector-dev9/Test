import assert from "node:assert/strict";
import test from "node:test";
import {
  parseUnifiedPatch,
  reverseUnifiedPatch,
  summarizePatchStats,
} from "./diff.js";

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

test("reverses modified, added, and deleted file patches", () => {
  const modified = [
    "diff --git a/f.txt b/f.txt",
    "index 1111111..2222222 100644",
    "--- a/f.txt",
    "+++ b/f.txt",
    "@@ -1,3 +1,3 @@",
    " one",
    "-two",
    "+TWO",
    " three",
    "",
  ].join("\n");

  const reversed = reverseUnifiedPatch(modified);
  assert.match(reversed, /^--- a\/f\.txt$/m);
  assert.match(reversed, /^\+\+\+ b\/f\.txt$/m);
  assert.match(reversed, /^@@ -1,3 \+1,3 @@$/m);
  assert.match(reversed, /^\+two$/m);
  assert.match(reversed, /^-TWO$/m);

  const added = [
    "diff --git a/new.txt b/new.txt",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/new.txt",
    "@@ -0,0 +1,2 @@",
    "+one",
    "+two",
    "",
  ].join("\n");

  const removed = reverseUnifiedPatch(added);
  assert.match(removed, /^deleted file mode 100644$/m);
  assert.match(removed, /^--- a\/new\.txt$/m);
  assert.match(removed, /^\+\+\+ \/dev\/null$/m);
  assert.match(removed, /^@@ -1,2 \+0,0 @@$/m);
  assert.match(removed, /^-one$/m);

  const deleted = [
    "diff --git a/gone.txt b/gone.txt",
    "deleted file mode 100644",
    "--- a/gone.txt",
    "+++ /dev/null",
    "@@ -1,1 +0,0 @@",
    "-gone",
    "",
  ].join("\n");

  const restored = reverseUnifiedPatch(deleted);
  assert.match(restored, /^new file mode 100644$/m);
  assert.match(restored, /^--- \/dev\/null$/m);
  assert.match(restored, /^\+\+\+ b\/gone\.txt$/m);
  assert.match(restored, /^@@ -0,0 \+1,1 @@$/m);
  assert.match(restored, /^\+gone$/m);

  assert.equal(reverseUnifiedPatch("not a patch"), "");
  assert.equal(reverseUnifiedPatch(null), "");
});

test("refuses to reverse ambiguous multi-file patches", () => {
  const first = [
    "diff --git a/a.txt b/a.txt",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -1,1 +1,1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");
  const second = [
    "diff --git a/b.txt b/b.txt",
    "--- a/b.txt",
    "+++ b/b.txt",
    "@@ -1,1 +1,1 @@",
    "-one",
    "+two",
    "",
  ].join("\n");

  assert.equal(reverseUnifiedPatch(`${first}${second}`), "");
});

test("reverses patches for paths with spaces", () => {
  const patch = [
    "diff --git a/docs/release notes.md b/docs/release notes.md",
    "--- a/docs/release notes.md",
    "+++ b/docs/release notes.md",
    "@@ -1,1 +1,1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");

  const reversed = reverseUnifiedPatch(patch);
  assert.match(
    reversed,
    /^diff --git a\/docs\/release notes\.md b\/docs\/release notes\.md$/m,
  );
  assert.match(reversed, /^-new$/m);
  assert.match(reversed, /^\+old$/m);
});
