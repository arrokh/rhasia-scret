package httpapi

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"math"
	"net/url"
	"strconv"
	"strings"
	"time"

	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

const (
	DefaultCursorPageSize = 20
	MaxCursorPageSize     = 50
	MaxTimestampCursorLen = 1_024
)

type timestampCursorPayload struct {
	Version   float64 `json:"version"`
	Scope     string  `json:"scope"`
	CreatedAt string  `json:"createdAt"`
	Key       string  `json:"key"`
}

func ParseTimestampCursorPageRequest(
	query url.Values,
	scope string,
	validKey func(string) bool,
) (sharedapp.CursorPageRequest, string) {
	if validKey == nil {
		validKey = func(string) bool { return true }
	}
	limit := DefaultCursorPageSize
	if query.Has("limit") {
		parsed, ok := parsePageLimit(query.Get("limit"))
		if !ok {
			return sharedapp.CursorPageRequest{}, "invalid_pagination"
		}
		limit = parsed
	}
	request := sharedapp.CursorPageRequest{Limit: limit}
	if !query.Has("cursor") {
		return request, ""
	}
	cursor, ok := decodeTimestampCursor(query.Get("cursor"), scope)
	if !ok || !validKey(cursor.Key) {
		return sharedapp.CursorPageRequest{}, "invalid_cursor"
	}
	request.Cursor = &cursor
	return request, ""
}

func EncodeTimestampCursor(cursor sharedapp.TimestampCursor, scope string) (string, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(timestampCursorPayload{
		Version:   1,
		Scope:     scope,
		CreatedAt: cursor.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		Key:       cursor.Key,
	}); err != nil {
		return "", err
	}
	payload := bytes.TrimSuffix(buffer.Bytes(), []byte("\n"))
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func decodeTimestampCursor(value string, scope string) (sharedapp.TimestampCursor, bool) {
	if value == "" || len(value) > MaxTimestampCursorLen {
		return sharedapp.TimestampCursor{}, false
	}
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(value)
	if err != nil || base64.RawURLEncoding.EncodeToString(decoded) != value {
		clear(decoded)
		return sharedapp.TimestampCursor{}, false
	}
	defer clear(decoded)
	var payload timestampCursorPayload
	if err := json.Unmarshal(decoded, &payload); err != nil || payload.Version != 1 || payload.Scope != scope ||
		payload.Key == "" || !ValidStringLength(payload.Key, 1, 256) {
		return sharedapp.TimestampCursor{}, false
	}
	createdAt, err := time.Parse("2006-01-02T15:04:05.000Z", payload.CreatedAt)
	if err != nil || createdAt.UTC().Format("2006-01-02T15:04:05.000Z") != payload.CreatedAt {
		return sharedapp.TimestampCursor{}, false
	}
	return sharedapp.TimestampCursor{CreatedAt: createdAt, Key: payload.Key}, true
}

func parsePageLimit(value string) (int, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0, false
	}
	var number float64
	var err error
	switch {
	case strings.HasPrefix(trimmed, "0x") || strings.HasPrefix(trimmed, "0X"):
		return parseRadixPageLimit(trimmed[2:], 16)
	case strings.HasPrefix(trimmed, "0b") || strings.HasPrefix(trimmed, "0B"):
		return parseRadixPageLimit(trimmed[2:], 2)
	case strings.HasPrefix(trimmed, "0o") || strings.HasPrefix(trimmed, "0O"):
		return parseRadixPageLimit(trimmed[2:], 8)
	default:
		number, err = strconv.ParseFloat(trimmed, 64)
	}
	if err != nil || math.Trunc(number) != number || number < 1 || number > MaxCursorPageSize {
		return 0, false
	}
	return int(number), true
}

func parseRadixPageLimit(value string, base int) (int, bool) {
	parsed, err := strconv.ParseUint(value, base, 64)
	if err != nil || parsed < 1 || parsed > uint64(MaxCursorPageSize) {
		return 0, false
	}
	return int(parsed), true
}
