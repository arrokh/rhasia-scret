import { z } from "zod";
import { Buffer } from "@api/shared/infrastructure/base64";

export const MAX_JSON_BODY_BYTES = 256 * 1024;
export const MAX_ENCRYPTED_BLOB_BYTES = 16 * 1024 + 29;
export const MAX_ROTATION_REQUEST_BYTES = 16 * 1024 * 1024;
export const MAX_ROTATION_ACCOUNTS = 500;
export const MAX_ROTATION_MEMBER_PACKAGES = 500;

export async function safeParseJsonBody<T extends z.ZodType>(
  request: Request,
  schema: T,
  maximumBytes = MAX_JSON_BODY_BYTES,
) {
  let body: string | null;
  try {
    body = await readBoundedRequestBody(request, maximumBytes);
  } catch {
    return schema.safeParse(null);
  }
  if (body === null) return schema.safeParse(null);

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(body);
  } catch {
    parsedBody = null;
  }
  return schema.safeParse(parsedBody);
}

export async function readBoundedRequestBody(request: Request, maximumBytes: number): Promise<string | null> {
  const contentLength = parseContentLength(request.headers.get("content-length"));
  if (contentLength !== null && contentLength > maximumBytes) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } finally {
      bytes.fill(0);
    }
  } finally {
    reader.releaseLock();
  }
}

export function boundedEncryptedBlobSchema(
  minimumBytes = 13,
  maximumBytes = MAX_ENCRYPTED_BLOB_BYTES,
): z.ZodType<string> {
  return z.base64().refine((value) => {
    const bytes = Buffer.byteLength(value, "base64");
    return bytes >= minimumBytes && bytes <= maximumBytes;
  });
}

export const routeParamSchema = z.string().min(1).max(128).regex(/^\S+$/);

export const routeParamsSchema = z.record(z.string(), routeParamSchema);

function parseContentLength(value: string | null): number | null {
  if (value === null) return null;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
