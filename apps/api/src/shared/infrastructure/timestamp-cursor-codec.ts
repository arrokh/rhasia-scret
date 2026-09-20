import { z } from "zod";
import { Buffer } from "./base64";
import {
  DEFAULT_CURSOR_PAGE_SIZE,
  MAX_CURSOR_PAGE_SIZE,
  type CursorPageRequest,
  type TimestampCursor,
} from "../application/cursor-page";

type CursorPayload = {
  version: 1;
  scope: string;
  createdAt: string;
  key: string;
};

export function encodeTimestampCursor(cursor: TimestampCursor, scope: string): string {
  const payload: CursorPayload = { version: 1, scope, createdAt: cursor.createdAt.toISOString(), key: cursor.key };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export type ParsedCursorPageRequest =
  { valid: true; request: CursorPageRequest } | { valid: false; error: "invalid_pagination" | "invalid_cursor" };

const cursorPageQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(MAX_CURSOR_PAGE_SIZE).default(DEFAULT_CURSOR_PAGE_SIZE),
    cursor: z.string().nullable(),
  })
  .strict();

export function parseTimestampCursorPageRequest(
  searchParams: URLSearchParams,
  scope: string,
  validKey: (key: string) => boolean = () => true,
): ParsedCursorPageRequest {
  const parsedQuery = cursorPageQuerySchema.safeParse({
    limit: searchParams.get("limit") ?? undefined,
    cursor: searchParams.get("cursor"),
  });
  if (!parsedQuery.success) return { valid: false, error: "invalid_pagination" };
  const cursor = decodeTimestampCursor(parsedQuery.data.cursor, scope);
  if (cursor === undefined || (cursor && !validKey(cursor.key))) return { valid: false, error: "invalid_cursor" };
  return { valid: true, request: { cursor, limit: parsedQuery.data.limit } };
}

export function decodeTimestampCursor(value: string | null, scope: string): TimestampCursor | null | undefined {
  if (value === null) return null;
  if (!value || value.length > 1_024) return undefined;
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) return undefined;
    const parsed = JSON.parse(decoded.toString("utf8")) as Partial<CursorPayload>;
    if (
      parsed.version !== 1 ||
      parsed.scope !== scope ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.key !== "string" ||
      !parsed.key ||
      parsed.key.length > 256
    )
      return undefined;
    const createdAt = new Date(parsed.createdAt);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== parsed.createdAt) return undefined;
    return { createdAt, key: parsed.key };
  } catch {
    return undefined;
  }
}
