package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"strings"
	"testing"
	"time"

	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

func TestTimestampCursorPageRequestUsesDefaultsAndCoercesIntegerLimits(t *testing.T) {
	request, errorCode := ParseTimestampCursorPageRequest(url.Values{}, "scope", nil)
	if errorCode != "" || request.Limit != DefaultCursorPageSize || request.Cursor != nil {
		t.Fatalf("default cursor page request=%#v error=%q", request, errorCode)
	}
	for _, testCase := range []struct {
		value string
		want  int
	}{
		{value: " 2.0 ", want: 2},
		{value: "0x10", want: 16},
		{value: "0b10000", want: 16},
		{value: "0o20", want: 16},
		{value: "0x32", want: MaxCursorPageSize},
		{value: "0b110010", want: MaxCursorPageSize},
		{value: "0o62", want: MaxCursorPageSize},
	} {
		query := url.Values{"limit": {testCase.value}}
		request, errorCode = ParseTimestampCursorPageRequest(query, "scope", nil)
		if errorCode != "" || request.Cursor != nil || request.Limit != testCase.want {
			t.Fatalf("coerced limit request=%#v error=%q query=%v; want %d", request, errorCode, query, testCase.want)
		}
	}
	for _, value := range []string{"", "0", "1.5", "51", "NaN", "Infinity", "0x100", "0xFFFFFFFFFFFFFFFF"} {
		_, errorCode := ParseTimestampCursorPageRequest(url.Values{"limit": {value}}, "scope", nil)
		if errorCode != "invalid_pagination" {
			t.Errorf("limit %q error=%q; want invalid_pagination", value, errorCode)
		}
	}
}

func TestTimestampCursorEncodingMatchesCanonicalTypeScriptPayload(t *testing.T) {
	createdAt := time.Date(2026, time.June, 7, 8, 9, 10, 123_000_000, time.FixedZone("synthetic-offset", -7*60*60))
	cursor := sharedapp.TimestampCursor{CreatedAt: createdAt, Key: "member:synthetic-user"}
	encoded, err := EncodeTimestampCursor(cursor, "vault-participants:synthetic-vault")
	if err != nil {
		t.Fatalf("encode timestamp cursor: %v", err)
	}
	decoded, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("decode encoded cursor: %v", err)
	}
	wantPayload := `{"version":1,"scope":"vault-participants:synthetic-vault","createdAt":"2026-06-07T15:09:10.123Z","key":"member:synthetic-user"}`
	if string(decoded) != wantPayload {
		t.Fatalf("encoded cursor payload=%s; want %s", decoded, wantPayload)
	}
	request, errorCode := ParseTimestampCursorPageRequest(url.Values{"limit": {"2"}, "cursor": {encoded}}, "vault-participants:synthetic-vault", func(key string) bool {
		return strings.HasPrefix(key, "member:")
	})
	if errorCode != "" || request.Limit != 2 || request.Cursor == nil || request.Cursor.Key != cursor.Key || !request.Cursor.CreatedAt.Equal(createdAt) {
		t.Fatalf("decode timestamp cursor request=%#v error=%q", request, errorCode)
	}
}

func TestTimestampCursorEncodingMatchesJavaScriptStringEscaping(t *testing.T) {
	cursor := sharedapp.TimestampCursor{
		CreatedAt: time.Date(2026, time.June, 7, 8, 9, 10, 0, time.UTC),
		Key:       "event<&>key",
	}
	encoded, err := EncodeTimestampCursor(cursor, `scope<&>`)
	if err != nil {
		t.Fatalf("encode timestamp cursor: %v", err)
	}
	decoded, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("decode encoded cursor: %v", err)
	}
	want := `{"version":1,"scope":"scope<&>","createdAt":"2026-06-07T08:09:10.000Z","key":"event<&>key"}`
	if string(decoded) != want {
		t.Fatalf("cursor payload=%s; want JavaScript-compatible %s", decoded, want)
	}
}

func TestTimestampCursorDecoderMatchesCanonicalValidationAndScope(t *testing.T) {
	cases := []struct {
		name    string
		payload string
		input   string
		valid   bool
	}{
		{name: "unknown payload fields allowed", payload: `{"version":1.0,"scope":"scope","createdAt":"2026-06-07T08:09:10.000Z","key":"member:user","extra":true}`, valid: true},
		{name: "wrong scope", payload: `{"version":1,"scope":"other","createdAt":"2026-06-07T08:09:10.000Z","key":"member:user"}`},
		{name: "noncanonical date", payload: `{"version":1,"scope":"scope","createdAt":"2026-06-07T08:09:10Z","key":"member:user"}`},
		{name: "wrong version", payload: `{"version":2,"scope":"scope","createdAt":"2026-06-07T08:09:10.000Z","key":"member:user"}`},
		{name: "empty key", payload: `{"version":1,"scope":"scope","createdAt":"2026-06-07T08:09:10.000Z","key":""}`},
		{name: "bad base64url", input: "%%%"},
		{name: "padded base64url", input: base64.RawURLEncoding.EncodeToString([]byte(`{"version":1}`)) + "="},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			value := testCase.input
			if value == "" {
				value = base64.RawURLEncoding.EncodeToString([]byte(testCase.payload))
			}
			request, errorCode := ParseTimestampCursorPageRequest(url.Values{"cursor": {value}}, "scope", func(key string) bool {
				return strings.HasPrefix(key, "member:")
			})
			valid := errorCode == "" && request.Cursor != nil
			if valid != testCase.valid {
				t.Fatalf("valid=%v error=%q request=%#v", valid, errorCode, request)
			}
		})
	}
	payload, err := json.Marshal(timestampCursorPayload{
		Version: 1, Scope: "scope", CreatedAt: "2026-06-07T08:09:10.000Z", Key: "member:user",
	})
	if err != nil {
		t.Fatalf("marshal cursor fixture: %v", err)
	}
	cursor := base64.RawURLEncoding.EncodeToString(payload)
	_, errorCode := ParseTimestampCursorPageRequest(url.Values{"cursor": {cursor}}, "scope", func(string) bool { return false })
	if errorCode != "invalid_cursor" {
		t.Fatalf("invalid key error=%q; want invalid_cursor", errorCode)
	}
}

func TestTimestampCursorRejectsOversizedCursor(t *testing.T) {
	value := strings.Repeat("a", MaxTimestampCursorLen+1)
	_, errorCode := ParseTimestampCursorPageRequest(url.Values{"cursor": {value}}, "scope", nil)
	if errorCode != "invalid_cursor" {
		t.Fatalf("oversized cursor error=%q; want invalid_cursor", errorCode)
	}
}
