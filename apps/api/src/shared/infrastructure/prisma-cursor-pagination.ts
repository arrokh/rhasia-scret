import type { TimestampCursor } from "../application/cursor-page";

type CursorComparison<T> = { lt: T } | { gt: T };
type TimestampCursorWhere<KeyField extends string> = {
  OR: [{ createdAt: CursorComparison<Date> }, { createdAt: Date } & Record<KeyField, CursorComparison<string>>];
};

export function timestampKeysetWhere<KeyField extends string>(
  cursor: TimestampCursor,
  keyField: KeyField,
  direction: "ascending" | "descending",
): TimestampCursorWhere<KeyField> {
  const dateComparison: CursorComparison<Date> =
    direction === "ascending" ? { gt: cursor.createdAt } : { lt: cursor.createdAt };
  const keyComparison: CursorComparison<string> = direction === "ascending" ? { gt: cursor.key } : { lt: cursor.key };
  return {
    OR: [
      { createdAt: dateComparison },
      { createdAt: cursor.createdAt, [keyField]: keyComparison } as { createdAt: Date } & Record<
        KeyField,
        CursorComparison<string>
      >,
    ],
  };
}
