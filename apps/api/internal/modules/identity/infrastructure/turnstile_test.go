package infrastructure

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

type roundTripFunction func(*http.Request) (*http.Response, error)

func (function roundTripFunction) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func turnstileResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
		Request:    &http.Request{},
	}
}

func TestTurnstileValidator(t *testing.T) {
	policy := &TurnstilePolicy{Kind: TurnstilePolicyStrict, ExpectedAction: "magic_link_request", ExpectedHostname: "auth.example.test"}

	t.Run("accepts any token when no server secret is configured", func(t *testing.T) {
		validator, err := NewTurnstileValidator(TurnstileConfiguration{}, nil)
		if err != nil {
			t.Fatalf("create validator: %v", err)
		}
		outcome, err := validator.Validate(context.Background(), "")
		if err != nil || outcome != TurnstileValid {
			t.Fatalf("Validate() = %q, %v", outcome, err)
		}
	})

	t.Run("rejects unsafe token before making a request", func(t *testing.T) {
		called := false
		validator, err := NewTurnstileValidator(TurnstileConfiguration{SecretKey: "synthetic-secret", Policy: policy}, &http.Client{
			Transport: roundTripFunction(func(*http.Request) (*http.Response, error) {
				called = true
				return turnstileResponse(http.StatusOK, `{"success":true}`), nil
			}),
		})
		if err != nil {
			t.Fatalf("create validator: %v", err)
		}
		outcome, err := validator.Validate(context.Background(), "unsafe token")
		if err != nil || outcome != TurnstileInvalid || called {
			t.Fatalf("Validate() = %q, %v; request called=%v", outcome, err, called)
		}
	})

	tests := []struct {
		name   string
		body   string
		want   TurnstileOutcome
		policy *TurnstilePolicy
	}{
		{name: "accepts matching strict provider response", body: `{"success":true,"action":"magic_link_request","hostname":"auth.example.test"}`, want: TurnstileValid, policy: policy},
		{name: "rejects mismatched action", body: `{"success":true,"action":"other","hostname":"auth.example.test"}`, want: TurnstileInvalid, policy: policy},
		{name: "rejects mismatched hostname", body: `{"success":true,"action":"magic_link_request","hostname":"other.example.test"}`, want: TurnstileInvalid, policy: policy},
		{name: "rejects unsuccessful provider response", body: `{"success":false,"action":"magic_link_request","hostname":"auth.example.test"}`, want: TurnstileInvalid, policy: policy},
		{name: "sandbox ignores response metadata", body: `{"success":true}`, want: TurnstileValid, policy: &TurnstilePolicy{Kind: TurnstilePolicySandbox}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			validator, err := NewTurnstileValidator(TurnstileConfiguration{SecretKey: "synthetic-secret", Policy: test.policy}, &http.Client{
				Transport: roundTripFunction(func(request *http.Request) (*http.Response, error) {
					if request.Method != http.MethodPost || request.URL.String() != turnstileVerificationURL {
						t.Errorf("unexpected provider request: %s %s", request.Method, request.URL)
					}
					if request.Header.Get("Content-Type") != "application/x-www-form-urlencoded" {
						t.Errorf("unexpected content type %q", request.Header.Get("Content-Type"))
					}
					form, err := url.ParseQuery(readRequestBody(t, request))
					if err != nil {
						t.Errorf("parse request body: %v", err)
					}
					if form.Get("secret") != "synthetic-secret" || form.Get("response") != strings.Repeat("t", 43) {
						t.Errorf("unexpected form fields: %#v", form)
					}
					return turnstileResponse(http.StatusOK, test.body), nil
				}),
			})
			if err != nil {
				t.Fatalf("create validator: %v", err)
			}
			outcome, err := validator.Validate(context.Background(), strings.Repeat("t", 43))
			if err != nil || outcome != test.want {
				t.Fatalf("Validate() = %q, %v; want %q", outcome, err, test.want)
			}
		})
	}

	t.Run("classifies transport and HTTP errors as unavailable", func(t *testing.T) {
		for _, test := range []struct {
			name      string
			transport roundTripFunction
			want      TurnstileUnavailableReason
			status    int
		}{
			{name: "transport", transport: func(*http.Request) (*http.Response, error) { return nil, errors.New("synthetic network failure") }, want: "transport"},
			{name: "http", transport: func(*http.Request) (*http.Response, error) {
				return turnstileResponse(http.StatusServiceUnavailable, `{"success":false}`), nil
			}, want: "http_error", status: http.StatusServiceUnavailable},
		} {
			t.Run(test.name, func(t *testing.T) {
				validator, err := NewTurnstileValidator(TurnstileConfiguration{SecretKey: "synthetic-secret", Policy: policy}, &http.Client{Transport: test.transport})
				if err != nil {
					t.Fatalf("create validator: %v", err)
				}
				diagnostics, err := validator.ValidateWithDiagnostics(context.Background(), strings.Repeat("t", 43))
				if err != nil || diagnostics.Result != TurnstileUnavailable || diagnostics.UnavailableReason != test.want {
					t.Fatalf("ValidateWithDiagnostics() = %#v, %v", diagnostics, err)
				}
				if test.status != 0 && (diagnostics.ResponseStatus == nil || *diagnostics.ResponseStatus != test.status) {
					t.Fatalf("provider status = %v; want %d", diagnostics.ResponseStatus, test.status)
				}
			})
		}
	})

	t.Run("classifies malformed and oversized provider responses as unavailable", func(t *testing.T) {
		for _, body := range []string{"not-json", `{"success":null}`, strings.Repeat(" ", 64*1024+1)} {
			validator, err := NewTurnstileValidator(TurnstileConfiguration{SecretKey: "synthetic-secret", Policy: policy}, &http.Client{
				Transport: roundTripFunction(func(*http.Request) (*http.Response, error) { return turnstileResponse(http.StatusOK, body), nil }),
			})
			if err != nil {
				t.Fatalf("create validator: %v", err)
			}
			outcome, err := validator.Validate(context.Background(), strings.Repeat("t", 43))
			if err != nil || outcome != TurnstileUnavailable {
				t.Fatalf("Validate() = %q, %v", outcome, err)
			}
		}
	})
}

func readRequestBody(t *testing.T, request *http.Request) string {
	t.Helper()
	body, err := io.ReadAll(request.Body)
	if err != nil {
		t.Fatalf("read request body: %v", err)
	}
	return string(body)
}
