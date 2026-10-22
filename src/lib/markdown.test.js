import assert from "node:assert/strict";
import test from "node:test";
import { parseInline, parseMarkdown } from "./markdown.js";

test("orders mixed markdown blocks in document sequence", () => {
  const doc = [
    "# Title",
    "",
    "A paragraph with a [link](https://example.com).",
    "",
    "- one",
    "- two",
    "  - nested",
    "",
    "> quoted words",
    "",
    "```js",
    "const x = 1;",
    "```",
    "",
    "| a | b |",
    "| - | - |",
    "| 1 | 2 |",
    "",
    "---",
    "",
    "final line",
  ].join("\n");

  const blocks = parseMarkdown(doc);

  assert.deepEqual(
    blocks.map((block) => block.type),
    [
      "heading",
      "paragraph",
      "list",
      "quote",
      "code",
      "table",
      "rule",
      "paragraph",
    ],
  );
});

test("keeps heading level and inline children", () => {
  const blocks = parseMarkdown("### Deep heading");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].level, 3);
  assert.deepEqual(blocks[0].children, [
    { type: "text", value: "Deep heading" },
  ]);
});

test("fenced code keeps language and raw body", () => {
  const blocks = parseMarkdown("```python\nprint('hi')\n```");
  assert.equal(blocks[0].type, "code");
  assert.equal(blocks[0].language, "python");
  assert.equal(blocks[0].value, "print('hi')");
});

test("supports ordered and unordered lists", () => {
  const [bullet] = parseMarkdown("- first\n- second");
  assert.equal(bullet.type, "list");
  assert.equal(bullet.ordered, false);
  assert.equal(bullet.items.length, 2);

  const [numbered] = parseMarkdown("1. first\n2. second");
  assert.equal(numbered.type, "list");
  assert.equal(numbered.ordered, true);
});

test("parses table cells as inline nodes", () => {
  const [table] = parseMarkdown(
    "| a | **b** |\n| - | - |\n| [x](https://x.test) | `c` |",
  );

  assert.equal(table.type, "table");
  assert.deepEqual(table.header, [
    [{ type: "text", value: "a" }],
    [{ type: "strong", children: [{ type: "text", value: "b" }] }],
  ]);
  assert.equal(table.rows[0][0][0].type, "link");
  assert.equal(table.rows[0][1][0].type, "code");
  assert.equal(table.rows[0][1][0].value, "c");
});

test("quote blocks nest parsed markdown", () => {
  const [quote] = parseMarkdown("> # inside");
  assert.equal(quote.type, "quote");
  assert.equal(quote.children[0].type, "heading");
});

test("returns no blocks for empty or non-text input", () => {
  assert.deepEqual(parseMarkdown(""), []);
  assert.deepEqual(parseMarkdown("   \n\n  "), []);
  assert.deepEqual(parseMarkdown(null), []);
  assert.deepEqual(parseMarkdown(42), []);
});

test("parses inline strong, code, and links", () => {
  const nodes = parseInline("use `code` with **bold** and [t](https://x.test)");

  const types = nodes.map((node) => node.type);
  assert.ok(types.includes("code"));
  assert.ok(types.includes("strong"));
  assert.ok(types.includes("link"));

  const strong = nodes.find((node) => node.type === "strong");
  assert.deepEqual(strong.children, [{ type: "text", value: "bold" }]);

  const link = nodes.find((node) => node.type === "link");
  assert.equal(link.href, "https://x.test");
  assert.deepEqual(link.children, [{ type: "text", value: "t" }]);
});

test("inline emphasis and autolinks resolve", () => {
  const emphasized = parseInline("soft *emphasis* here");
  assert.ok(emphasized.some((node) => node.type === "emphasis"));

  const struck = parseInline("gone ~~soon~~ here");
  assert.ok(struck.some((node) => node.type === "strike"));

  const [autolink] = parseInline("<https://auto.test/path>");
  assert.equal(autolink.type, "link");
  assert.equal(autolink.href, "https://auto.test/path");
});

test("honors escapes and leaves snake_case as plain text", () => {
  const escaped = parseInline("\\*not emphasis\\*");
  assert.deepEqual(escaped, [{ type: "text", value: "*not emphasis*" }]);

  const snake = parseInline("keep snake_case_name intact");
  assert.deepEqual(snake, [{ type: "text", value: "keep snake_case_name intact" }]);
});

test("paragraph text survives line endings and wrapping", () => {
  const [paragraph] = parseMarkdown("first\r\nsecond");
  assert.equal(paragraph.type, "paragraph");
});

test("keeps the parser output in the shape the renderer expects", () => {
  // A mismatch here is what blanks the app: the renderer walks these fields
  // directly, so every one of them has to match what it produces.
  const doc = [
    "# Title",
    "",
    "A paragraph with a [link](https://example.com) and `code`.",
    "",
    "- one",
    "- two",
    "  - nested",
    "",
    "1. first",
    "",
    "> quoted words",
    "",
    "```js",
    "const x = 1;",
    "```",
    "",
    "| a | **b** |",
    "| - | - |",
    "| 1 | [x](https://x.test) |",
    "",
    "---",
    "",
    "final line",
  ].join("\n");

  const blocks = parseMarkdown(doc);

  const isInlineNode = (node) =>
    node &&
    typeof node === "object" &&
    typeof node.type === "string" &&
    ("value" in node || "children" in node || "href" in node);

  for (const block of blocks) {
    switch (block.type) {
      case "paragraph":
      case "heading":
        assert.ok(Array.isArray(block.children), `${block.type} children`);
        assert.ok(block.children.every(isInlineNode));
        break;
      case "quote":
        assert.ok(Array.isArray(block.children));
        break;
      case "code":
        assert.equal(typeof block.value, "string");
        break;
      case "rule":
        break;
      case "list": {
        assert.ok(Array.isArray(block.items));
        for (const item of block.items) {
          assert.ok(Array.isArray(item.children));
        }
        break;
      }
      case "table":
        assert.ok(Array.isArray(block.header));
        assert.ok(Array.isArray(block.rows));
        assert.ok(block.header.every((cell) => Array.isArray(cell)));
        assert.ok(
          block.rows.every((row) => Array.isArray(row) && row.every((cell) => Array.isArray(cell))),
        );
        assert.ok(
          block.header.every((cell) => cell.every(isInlineNode)),
        );
        assert.ok(
          block.rows.every((row) => row.every((cell) => cell.every(isInlineNode))),
        );
        break;
      default:
        assert.fail(`unexpected block type ${block.type}`);
    }
  }
});
