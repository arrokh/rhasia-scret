import { Buffer } from "node:buffer";

type ParsedEmail = Readonly<{
  to: string;
  subject: string;
  text: string;
}>;

export function extractMagicLinkToken(message: string): string {
  const email = parseEmail(message);
  const match = /#token=([A-Za-z0-9_-]{43,128})(?:&|\s|$)/.exec(email.text);
  if (!match?.[1]) throw new Error("A synthetic magic-link email did not contain a valid one-time token.");
  return match[1];
}

export function assertMagicLinkEmailsMatch(tsMessage: string, goMessage: string): void {
  const tsEmail = parseEmail(tsMessage);
  const goEmail = parseEmail(goMessage);
  const normalize = (email: ParsedEmail): ParsedEmail => ({
    to: email.to,
    subject: email.subject,
    text: email.text.replace(/#token=[A-Za-z0-9_-]{43,128}/g, "#token=<one-time-token>"),
  });
  if (JSON.stringify(normalize(tsEmail)) !== JSON.stringify(normalize(goEmail))) {
    throw new Error("TypeScript and Go magic-link email contents differ.");
  }
}

export function extractDeletionOTP(message: string): string {
  const email = parseEmail(message);
  const match = /code\s*:\s*(\d{6})/i.exec(email.text);
  if (!match?.[1]) throw new Error("A synthetic account-deletion email did not contain a valid one-time code.");
  return match[1];
}

export function assertDeletionEmailsMatch(tsMessage: string, goMessage: string): void {
  const tsEmail = parseEmail(tsMessage);
  const goEmail = parseEmail(goMessage);
  const normalize = (email: ParsedEmail): ParsedEmail => ({
    to: email.to,
    subject: email.subject,
    text: email.text
      .replace(/\b\d{6}\b/g, "<one-time-code>")
      .replace(/([^\n]+): [A-Za-z0-9_-]{16,128}$/m, "$1: <receipt>"),
  });
  if (JSON.stringify(normalize(tsEmail)) !== JSON.stringify(normalize(goEmail))) {
    throw new Error("TypeScript and Go account-deletion email contents differ.");
  }
}

function parseEmail(message: string): ParsedEmail {
  const headerEnd = message.indexOf("\r\n\r\n");
  if (headerEnd < 0) throw new Error("The synthetic SMTP fixture received an invalid MIME message.");
  const headers = parseHeaders(message.slice(0, headerEnd));
  const contentType = headers.get("content-type") ?? "";
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  if (!boundary?.[1] && !boundary?.[2]) throw new Error("The synthetic SMTP fixture received an invalid MIME message.");
  const boundaryValue = boundary[1] ?? boundary[2] ?? "";
  const parts = message.slice(headerEnd + 4).split(`--${boundaryValue}`);
  for (const part of parts) {
    const partHeaderEnd = part.indexOf("\r\n\r\n");
    if (partHeaderEnd < 0) continue;
    const partHeaders = parseHeaders(part.slice(0, partHeaderEnd));
    if (!(partHeaders.get("content-type") ?? "").toLowerCase().startsWith("text/plain")) continue;
    const encoded = part
      .slice(partHeaderEnd + 4)
      .replace(/\r?\n--?\s*$/, "")
      .trimEnd();
    const transferEncoding = (partHeaders.get("content-transfer-encoding") ?? "7bit").toLowerCase();
    const text = decodeBody(encoded, transferEncoding).replace(/\r\n/g, "\n").trim();
    const recipient = parseAddress(headers.get("to") ?? "");
    const subject = decodeHeader(headers.get("subject") ?? "");
    if (!recipient || !subject || !text) break;
    return { to: recipient.toLowerCase(), subject, text };
  }
  throw new Error("The synthetic SMTP fixture received an invalid plain-text email part.");
}

function parseHeaders(raw: string): Map<string, string> {
  const headers = new Map<string, string>();
  let currentName = "";
  for (const line of raw.replace(/\r\n[ \t]+/g, " ").split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator > 0) {
      currentName = line.slice(0, separator).trim().toLowerCase();
      headers.set(currentName, line.slice(separator + 1).trim());
      continue;
    }
    if (currentName && /^[ \t]/.test(line)) {
      headers.set(currentName, `${headers.get(currentName) ?? ""} ${line.trim()}`);
    }
  }
  return headers;
}

function parseAddress(value: string): string {
  const match = /<([^<>\s]+)>/.exec(value);
  return match?.[1] ?? value.trim();
}

function decodeHeader(value: string): string {
  return value.replace(
    /=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,
    (_match, charset: string, encoding: string, data: string) => {
      const bytes = encoding.toLowerCase() === "b" ? Buffer.from(data, "base64") : decodeQuotedPrintable(data);
      return bytes.toString(charset.toLowerCase() === "utf-8" ? "utf8" : "latin1");
    },
  );
}

function decodeBody(value: string, encoding: string): string {
  if (encoding === "base64") return Buffer.from(value.replace(/\s/g, ""), "base64").toString("utf8");
  if (encoding === "quoted-printable") return decodeQuotedPrintable(value).toString("utf8");
  return value;
}

function decodeQuotedPrintable(value: string): Buffer {
  const decoded = value
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  return Buffer.from(decoded, "latin1");
}
