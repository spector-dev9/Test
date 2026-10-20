import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_PROMPT_ATTACHMENTS,
  MAX_TOTAL_ATTACHMENT_BYTES,
  formatAttachmentSize,
  imageDataUrlBytes,
  normalizeImageAttachment,
  normalizeImageAttachments,
} from "./attachments.js";

const PNG_URL = "data:image/png;base64,iVBORw0KGgo=";
const JPEG_URL = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

test("normalizes safe image attachments", () => {
  assert.deepEqual(
    normalizeImageAttachment({
      mime: "image/png",
      filename: "screenshot.png",
      url: PNG_URL,
    }),
    { mime: "image/png", filename: "screenshot.png", url: PNG_URL },
  );

  assert.equal(
    normalizeImageAttachment({
      mime: "image/jpeg",
      filename: "../../photo.jpg",
      url: JPEG_URL,
    }).filename,
    "....photo.jpg",
  );

  assert.deepEqual(
    normalizeImageAttachments([
      { mime: "image/png", filename: "a.png", url: PNG_URL },
      { mime: "image/jpeg", filename: "b.jpg", url: JPEG_URL },
    ]).length,
    2,
  );
});

test("rejects unsupported or unsafe image attachments", () => {
  const invalid = [
    null,
    {},
    { mime: "image/svg+xml", filename: "x.svg", url: PNG_URL },
    { mime: "image/png", filename: "x.png", url: "https://example.com/x.png" },
    {
      mime: "image/png",
      filename: "x.png",
      url: "data:image/jpeg;base64,iVBORw0KGgo=",
    },
    {
      mime: "image/png",
      filename: "x.png",
      url: "data:image/png;base64,",
    },
    {
      mime: "image/png",
      filename: "x.png",
      url: "data:image/png;base64,not base64!",
    },
  ];

  for (const value of invalid) {
    assert.equal(normalizeImageAttachment(value), null);
  }

  assert.equal(
    normalizeImageAttachments(
      Array.from({ length: MAX_PROMPT_ATTACHMENTS + 1 }, () => ({
        mime: "image/png",
        filename: "x.png",
        url: PNG_URL,
      })),
    ),
    null,
  );
});

test("rejects oversized images and attachment totals", () => {
  const oversized = `data:image/png;base64,${"A".repeat(
    Math.ceil(((MAX_ATTACHMENT_BYTES + 1) * 4) / 3),
  )}`;

  assert.equal(
    normalizeImageAttachment({
      mime: "image/png",
      filename: "large.png",
      url: oversized,
    }),
    null,
  );

  const chunk = Math.ceil(((MAX_ATTACHMENT_BYTES - 1) * 4) / 3);
  const url = `data:image/png;base64,${"A".repeat(chunk)}`;
  const needed = Math.ceil(
    MAX_TOTAL_ATTACHMENT_BYTES / MAX_ATTACHMENT_BYTES + 1,
  );

  assert.ok(needed <= MAX_PROMPT_ATTACHMENTS);
  assert.equal(
    normalizeImageAttachments(
      Array.from({ length: needed }, () => ({
        mime: "image/png",
        filename: "x.png",
        url,
      })),
    ),
    null,
  );
});

test("reports image byte sizes without decoding", () => {
  assert.equal(imageDataUrlBytes(PNG_URL), 8);
  assert.equal(imageDataUrlBytes("data:image/png;base64,AAAA"), 3);
  assert.equal(imageDataUrlBytes("not-a-data-url"), 0);
  assert.equal(formatAttachmentSize(512), "1 KB");
  assert.equal(formatAttachmentSize(1536 * 1024), "1.5 MB");
});
