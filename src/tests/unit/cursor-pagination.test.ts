import { describe, expect, it } from "vitest";
import { buildCursorPage } from "@/shared/application/cursor-page";
import { encodeTimestampCursor, parseTimestampCursorPageRequest } from "@/shared/infrastructure/timestamp-cursor-codec";
import { timestampKeysetWhere } from "@/shared/infrastructure/prisma-cursor-pagination";

describe("shared cursor pagination", () => {
  it("builds a bounded page and emits a cursor only when another row exists", () => {
    const rows = [
      { id: "event-3", createdAt: new Date("2026-07-26T12:00:00.000Z") },
      { id: "event-2", createdAt: new Date("2026-07-26T12:00:00.000Z") },
      { id: "event-1", createdAt: new Date("2026-07-26T11:00:00.000Z") }
    ];
    expect(buildCursorPage(rows, 2, (row) => ({ createdAt: row.createdAt, key: row.id }))).toEqual({
      items: rows.slice(0, 2),
      nextCursor: { createdAt: rows[1]!.createdAt, key: "event-2" }
    });
    expect(buildCursorPage(rows.slice(0, 2), 2, (row) => ({ createdAt: row.createdAt, key: row.id })).nextCursor).toBeNull();
  });

  it("creates reusable stable tie-break predicates in either sort direction", () => {
    const cursor = { createdAt: new Date("2026-07-26T12:00:00.000Z"), key: "row-2" };
    expect(timestampKeysetWhere(cursor, "id", "descending")).toEqual({ OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: "row-2" } }] });
    expect(timestampKeysetWhere(cursor, "userId", "ascending")).toEqual({ OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, userId: { gt: "row-2" } }] });
  });

  it("round-trips scoped cursors and rejects malformed, cross-list, and invalid-limit requests", () => {
    const cursor = encodeTimestampCursor({ createdAt: new Date("2026-07-26T12:00:00.000Z"), key: "event-2" }, "audit:vault-1");
    expect(parseTimestampCursorPageRequest(new URLSearchParams({ cursor, limit: "25" }), "audit:vault-1")).toEqual({
      valid: true,
      request: { cursor: { createdAt: new Date("2026-07-26T12:00:00.000Z"), key: "event-2" }, limit: 25 }
    });
    expect(parseTimestampCursorPageRequest(new URLSearchParams({ cursor }), "participants:vault-1")).toEqual({ valid: false, error: "invalid_cursor" });
    expect(parseTimestampCursorPageRequest(new URLSearchParams({ cursor: "not-json" }), "audit:vault-1")).toEqual({ valid: false, error: "invalid_cursor" });
    expect(parseTimestampCursorPageRequest(new URLSearchParams({ cursor: `${cursor}!` }), "audit:vault-1")).toEqual({ valid: false, error: "invalid_cursor" });
    expect(parseTimestampCursorPageRequest(new URLSearchParams({ limit: "51" }), "audit:vault-1")).toEqual({ valid: false, error: "invalid_pagination" });
  });
});
