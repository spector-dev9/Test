import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_FILE_CONTENT_CHARS,
  buildFilePatch,
  detectLineEnding,
  fileLanguage,
  fromEditorText,
  normalizeFileContent,
  normalizeFileNodes,
  normalizePatchPath,
  normalizeProjectPath,
  toEditorText,
  validateFilePatch,
} from "./files.js";

test("normalizes relative project paths without traversal", () => {
  assert.equal(normalizeProjectPath("src/App.jsx"), "src/App.jsx");
  assert.equal(normalizeProjectPath("src/components/"), "src/components");
  assert.equal(normalizeProjectPath(".", { allowRoot: true }), ".");
  assert.equal(normalizeProjectPath(""), null);

  for (const value of [
    "/etc/passwd",
    "../secret",
    "src/../secret",
    "src/./file",
    "src//file",
    "src/\0file",
    "src/\nfile",
    null,
  ]) {
    assert.equal(normalizeProjectPath(value), null);
  }

  assert.equal(normalizePatchPath("src/App.jsx"), "src/App.jsx");
  assert.equal(normalizePatchPath("src/with space.js"), null);
  assert.equal(normalizePatchPath("src/quote\".js"), null);
  assert.equal(normalizePatchPath(".git/config"), null);
  assert.equal(normalizePatchPath("src/.git/hooks/pre-commit"), null);
});

test("builds and validates a safe full-file patch", () => {
  const patch = buildFilePatch({
    path: "src/example.js",
    previousContent: "const value = 1;\n",
    nextContent: "const value = 2;\nexport default value;\n",
  });

  assert.match(patch, /^diff --git a\/src\/example\.js b\/src\/example\.js/m);
  assert.match(patch, /^@@ -1,1 \+1,2 @@/m);
  assert.deepEqual(validateFilePatch(patch), {
    path: "src/example.js",
    isNew: false,
  });
});

test("builds patches for new files and missing trailing newlines", () => {
  const newFilePatch = buildFilePatch({
    path: "notes/todo.md",
    nextContent: "First item",
    isNew: true,
  });

  assert.match(newFilePatch, /^new file mode 100644$/m);
  assert.match(newFilePatch, /^--- \/dev\/null$/m);

  assert.deepEqual(validateFilePatch(newFilePatch), {
    path: "notes/todo.md",
    isNew: true,
  });

  const noNewlinePatch = buildFilePatch({
    path: "src/example.js",
    previousContent: "one\ntwo",
    nextContent: "one\nthree",
  });

  assert.match(noNewlinePatch, /^\\ No newline at end of file$/m);
});

test("rejects unsafe or ambiguous patches", () => {
  const valid = buildFilePatch({
    path: "src/a.js",
    previousContent: "a\n",
    nextContent: "b\n",
  });

  assert.equal(
    validateFilePatch(
      valid.replace("a/src/a.js", "a/../src/a.js"),
    ),
    null,
  );
  assert.equal(
    validateFilePatch(`${valid}${valid}`),
    null,
  );
  assert.equal(
    validateFilePatch(
      valid
        .replace("--- a/src/a.js", "--- /dev/null")
        .replace("+++ b/src/a.js", "+++ b/src/other.js"),
    ),
    null,
  );
  assert.equal(
    validateFilePatch(
      valid.replace("diff --git", "deleted file mode 100644\ndiff --git"),
    ),
    null,
  );
  assert.equal(
    validateFilePatch(
      valid.replace(
        "diff --git",
        "new file mode 120000\ndiff --git",
      ),
    ),
    null,
  );
  assert.equal(validateFilePatch(""), null);
  assert.throws(() =>
    buildFilePatch({ path: "../secret", previousContent: "", nextContent: "x" }),
  );
  assert.throws(() =>
    buildFilePatch({ path: "empty.txt", nextContent: "", isNew: true }),
  );
  assert.throws(() =>
    buildFilePatch({
      path: ".git/config",
      previousContent: "",
      nextContent: "[core]\n",
    }),
  );
});

test("preserves line endings while editing", () => {
  const content = "one\r\ntwo\r\n";
  assert.equal(detectLineEnding(content), "\r\n");
  assert.equal(toEditorText(content), "one\ntwo\n");
  assert.equal(fromEditorText("one\nthree\n", "\r\n"), "one\r\nthree\r\n");
  assert.equal(toEditorText("one\ntwo\n"), "one\ntwo\n");
});

test("normalizes directory listings and file metadata", () => {
  const rows = normalizeFileNodes("/data/project", [
    {
      name: "src",
      path: "src/",
      absolute: "/data/project/src/",
      type: "directory",
      ignored: false,
    },
    {
      name: "README.md",
      path: "README.md",
      absolute: "/data/project/README.md",
      type: "file",
      ignored: false,
    },
    {
      name: "escape",
      path: "../escape",
      absolute: "/data/escape",
      type: "file",
    },
  ]);

  assert.deepEqual(rows, [
    { name: "src", path: "src", type: "directory", ignored: false },
    { name: "README.md", path: "README.md", type: "file", ignored: false },
  ]);

  assert.deepEqual(normalizeFileContent({
    type: "text",
    content: "hello",
    mimeType: "text/plain",
  }), {
    type: "text",
    content: "hello",
    encoding: null,
    mimeType: "text/plain",
  });

  assert.throws(() =>
    normalizeFileContent({
      type: "text",
      content: "x".repeat(MAX_FILE_CONTENT_CHARS + 1),
    }),
  );
  assert.throws(() => normalizeFileContent({ type: "video" }));
  assert.equal(fileLanguage("src/App.jsx"), "JSX");
});
