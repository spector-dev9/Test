export const MAX_PROMPT_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 1_200_000;
export const MAX_TOTAL_ATTACHMENT_BYTES = 1_900_000;

const IMAGE_MIME_PATTERN = /^image\/(png|jpeg|webp|gif)$/;
const IMAGE_DATA_URL_PATTERN =
  /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/;
function stripControlCharacters(value) {
  return Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("");
}

export function imageDataUrlBytes(url) {
  if (typeof url !== "string") return 0;

  const match = IMAGE_DATA_URL_PATTERN.exec(url);
  if (!match) return 0;

  const base64 = match[2];
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;

  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export function normalizeImageAttachment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const { mime, filename, url, type } = value;

  if (type !== undefined && type !== "file") return null;

  if (typeof mime !== "string" || !IMAGE_MIME_PATTERN.test(mime)) {
    return null;
  }

  const match =
    typeof url === "string" ? IMAGE_DATA_URL_PATTERN.exec(url) : null;

  if (!match || match[1] !== mime) return null;

  const bytes = imageDataUrlBytes(url);
  if (bytes <= 0 || bytes > MAX_ATTACHMENT_BYTES) return null;

  const extension = mime === "image/jpeg" ? "jpg" : mime.split("/")[1];
  let name =
    typeof filename === "string"
      ? stripControlCharacters(filename)
          .replace(/[\\/]/g, "")
          .trim()
          .slice(0, 120)
      : "";

  if (!name) name = `image.${extension}`;

  return { mime, filename: name, url };
}

export function normalizeImageAttachments(values) {
  if (!Array.isArray(values) || values.length > MAX_PROMPT_ATTACHMENTS) {
    return null;
  }

  const result = [];
  let totalBytes = 0;

  for (const value of values) {
    const attachment = normalizeImageAttachment(value);
    if (!attachment) return null;

    totalBytes += imageDataUrlBytes(attachment.url);
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) return null;

    result.push(attachment);
  }

  return result;
}

export function formatAttachmentSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
