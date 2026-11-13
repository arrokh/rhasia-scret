package httpapi

import (
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type validationFixture struct {
	Name   string `json:"name"`
	Nested struct {
		Value string `json:"value"`
	} `json:"nested"`
}

type positiveSafeIntegerFixture struct {
	Value PositiveSafeInteger `json:"value"`
}

func TestDecodeJSONBodyUsesBoundedStrictJSONWithoutContentTypeRequirement(t *testing.T) {
	t.Parallel()

	request := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"name":"synthetic","nested":{"value":"fixture"}}`))
	request.Header.Del("Content-Type")
	decoded, err := DecodeJSONBody[validationFixture](request, MaxJSONBodyBytes)
	if err != nil {
		t.Fatalf("DecodeJSONBody(): %v", err)
	}
	if decoded.Name != "synthetic" || decoded.Nested.Value != "fixture" {
		t.Fatalf("decoded body = %#v", decoded)
	}
}

func TestDecodeJSONBodyRejectsMalformedNullTrailingAndUnknownFields(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		body string
	}{
		{name: "empty", body: ""},
		{name: "malformed", body: `{"name":`},
		{name: "null", body: "null"},
		{name: "trailing value", body: `{"name":"first"} {"name":"second"}`},
		{name: "unknown field", body: `{"name":"synthetic","unsupported":true}`},
		{name: "case mismatch", body: `{"NAME":"synthetic"}`},
		{name: "unknown nested field", body: `{"nested":{"value":"ok","unsupported":true}}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			request := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(test.body))
			if _, err := DecodeJSONBody[validationFixture](request, MaxJSONBodyBytes); !errors.Is(err, ErrInvalidJSONBody) {
				t.Fatalf("DecodeJSONBody() error = %v; want ErrInvalidJSONBody", err)
			}
		})
	}
}

func TestDecodeJSONBodyRejectsOversizeIncludingUnknownLengthBodies(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name              string
		unknownContentLen bool
	}{
		{name: "content length"},
		{name: "streamed", unknownContentLen: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			request := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"name":"larger-than-limit"}`))
			if test.unknownContentLen {
				request.ContentLength = -1
			}
			if _, err := DecodeJSONBody[validationFixture](request, 8); !errors.Is(err, ErrJSONBodyTooLarge) {
				t.Fatalf("DecodeJSONBody() error = %v; want ErrJSONBodyTooLarge", err)
			}
		})
	}
}

func TestValidRouteParameterMatchesBoundedNonWhitespaceContract(t *testing.T) {
	t.Parallel()

	if !ValidRouteParameter("opaque-id") || !ValidRouteParameter(strings.Repeat("😀", 64)) || !ValidRouteParameter("id\u0085value") {
		t.Fatal("valid route parameter was rejected")
	}
	for _, value := range []string{"", "a b", "\t", "id\ufeffvalue", strings.Repeat("a", 129), strings.Repeat("😀", 65)} {
		if ValidRouteParameter(value) {
			t.Fatalf("invalid route parameter %q was accepted", value)
		}
	}
}

func TestValidStringLengthMatchesJavaScriptStringLength(t *testing.T) {
	t.Parallel()

	if !ValidStringLength("", 0, 128) || !ValidStringLength(strings.Repeat("😀", 64), 1, 128) {
		t.Fatal("valid bounded string was rejected")
	}
	for _, value := range []string{"", strings.Repeat("😀", 65)} {
		if ValidStringLength(value, 1, 128) {
			t.Fatalf("invalid bounded string %q was accepted", value)
		}
	}
}

func TestPositiveSafeIntegerAcceptsIntegralJSONNumbersAndRejectsInvalidValues(t *testing.T) {
	t.Parallel()

	for _, body := range []string{
		`{"value":1}`,
		`{"value":1.0}`,
		`{"value":1e0}`,
		`{"value":9007199254740991}`,
	} {
		request := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
		parsed, err := DecodeJSONBody[positiveSafeIntegerFixture](request, MaxJSONBodyBytes)
		if err != nil || parsed.Value < 1 {
			t.Errorf("positive safe integer %s: value=%d err=%v", body, parsed.Value, err)
		}
	}
	for _, body := range []string{
		`{"value":null}`,
		`{"value":0}`,
		`{"value":-1}`,
		`{"value":1.5}`,
		`{"value":9007199254740992}`,
	} {
		request := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
		if _, err := DecodeJSONBody[positiveSafeIntegerFixture](request, MaxJSONBodyBytes); !errors.Is(err, ErrInvalidJSONBody) {
			t.Errorf("invalid positive safe integer %s: err=%v; want ErrInvalidJSONBody", body, err)
		}
	}
	request := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{}`))
	parsed, err := DecodeJSONBody[positiveSafeIntegerFixture](request, MaxJSONBodyBytes)
	if err != nil || parsed.Value != 0 {
		t.Fatalf("missing field should be handled by required-field validation: value=%d err=%v", parsed.Value, err)
	}
}

func TestDecodeBoundedBase64EnforcesCanonicalEncodingAndBounds(t *testing.T) {
	t.Parallel()

	encoded := base64.StdEncoding.EncodeToString([]byte{1, 2, 3})
	decoded, err := DecodeBoundedBase64(encoded, 3, 3)
	if err != nil {
		t.Fatalf("DecodeBoundedBase64(): %v", err)
	}
	if string(decoded) != string([]byte{1, 2, 3}) {
		t.Fatalf("decoded bytes = %v", decoded)
	}
	for _, value := range []string{encoded + "\n", "not-base64", base64.StdEncoding.EncodeToString([]byte{1, 2})} {
		if decoded, err := DecodeBoundedBase64(value, 3, 3); !errors.Is(err, ErrInvalidBase64) || decoded != nil {
			t.Fatalf("DecodeBoundedBase64(%q) = %v, %v; want nil, ErrInvalidBase64", value, decoded, err)
		}
	}
}
