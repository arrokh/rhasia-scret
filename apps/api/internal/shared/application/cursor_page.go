package application

import (
	"time"
)

type TimestampCursor struct {
	CreatedAt time.Time
	Key       string
}

type CursorPageRequest struct {
	Cursor *TimestampCursor
	Limit  int
}

type CursorPage[T any] struct {
	Items      []T
	NextCursor *TimestampCursor
}

func BuildCursorPage[T any](rows []T, limit int, cursorFor func(T) TimestampCursor) CursorPage[T] {
	if limit < 0 {
		limit = 0
	}
	end := len(rows)
	if end > limit {
		end = limit
	}
	items := make([]T, end)
	copy(items, rows[:end])
	var nextCursor *TimestampCursor
	if len(rows) > limit && end > 0 {
		value := cursorFor(items[end-1])
		nextCursor = &value
	}
	return CursorPage[T]{Items: items, NextCursor: nextCursor}
}
