export type TimestampCursor = {
  createdAt: Date;
  key: string;
};

export type CursorPage<T> = {
  items: T[];
  nextCursor: TimestampCursor | null;
};

export type CursorPageRequest = {
  cursor: TimestampCursor | null;
  limit: number;
};

export const DEFAULT_CURSOR_PAGE_SIZE = 20;
export const MAX_CURSOR_PAGE_SIZE = 50;

export function buildCursorPage<T>(rows: T[], limit: number, cursorFor: (item: T) => TimestampCursor): CursorPage<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? cursorFor(last) : null
  };
}
