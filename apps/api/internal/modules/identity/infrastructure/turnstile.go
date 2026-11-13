package infrastructure

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf16"
)

const (
	turnstileVerificationURL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
	maxTurnstileTokenLength  = 2048
)

type TurnstileOutcome string

const (
	TurnstileValid       TurnstileOutcome = "valid"
	TurnstileInvalid     TurnstileOutcome = "invalid"
	TurnstileUnavailable TurnstileOutcome = "unavailable"
)

type TurnstileUnavailableReason string

type TurnstileValidationDiagnostics struct {
	Result            TurnstileOutcome
	UnavailableReason TurnstileUnavailableReason
	ResponseStatus    *int
}

type TurnstilePolicyKind string

const (
	TurnstilePolicySandbox TurnstilePolicyKind = "sandbox"
	TurnstilePolicyStrict  TurnstilePolicyKind = "strict"
)

type TurnstilePolicy struct {
	Kind             TurnstilePolicyKind
	ExpectedAction   string
	ExpectedHostname string
}

type TurnstileConfiguration struct {
	SecretKey string
	Policy    *TurnstilePolicy
}

type TurnstileValidator struct {
	configuration TurnstileConfiguration
	client        *http.Client
}

func NewTurnstileValidator(configuration TurnstileConfiguration, client *http.Client) (*TurnstileValidator, error) {
	configuration.SecretKey = strings.TrimSpace(configuration.SecretKey)
	if configuration.SecretKey != "" && configuration.Policy == nil {
		return nil, fmt.Errorf("Turnstile validation policy is missing")
	}
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	return &TurnstileValidator{configuration: configuration, client: client}, nil
}

func (validator *TurnstileValidator) Validate(ctx context.Context, token string) (TurnstileOutcome, error) {
	diagnostics, err := validator.ValidateWithDiagnostics(ctx, token)
	return diagnostics.Result, err
}

func (validator *TurnstileValidator) ValidateWithDiagnostics(ctx context.Context, token string) (TurnstileValidationDiagnostics, error) {
	if validator.configuration.SecretKey == "" {
		return TurnstileValidationDiagnostics{Result: TurnstileValid}, nil
	}
	if validator.configuration.Policy == nil || !IsSafeTurnstileToken(token) {
		return TurnstileValidationDiagnostics{Result: TurnstileInvalid}, nil
	}
	form := url.Values{}
	form.Set("secret", validator.configuration.SecretKey)
	form.Set("response", token)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, turnstileVerificationURL, strings.NewReader(form.Encode()))
	if err != nil {
		return TurnstileValidationDiagnostics{Result: TurnstileUnavailable, UnavailableReason: "factory_error"}, fmt.Errorf("create Turnstile request: %w", err)
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := validator.client.Do(request)
	if err != nil {
		return TurnstileValidationDiagnostics{Result: TurnstileUnavailable, UnavailableReason: "transport"}, nil
	}
	defer response.Body.Close()
	status := response.StatusCode
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return TurnstileValidationDiagnostics{Result: TurnstileUnavailable, UnavailableReason: "http_error", ResponseStatus: &status}, nil
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 64*1024+1))
	if err != nil || len(body) > 64*1024 {
		return TurnstileValidationDiagnostics{Result: TurnstileUnavailable, UnavailableReason: "malformed_response", ResponseStatus: &status}, nil
	}
	var result struct {
		Success  *bool  `json:"success"`
		Action   string `json:"action"`
		Hostname string `json:"hostname"`
	}
	if err := json.Unmarshal(body, &result); err != nil || result.Success == nil {
		return TurnstileValidationDiagnostics{Result: TurnstileUnavailable, UnavailableReason: "malformed_response", ResponseStatus: &status}, nil
	}
	policy := validator.configuration.Policy
	metadataMatches := policy.Kind == TurnstilePolicySandbox || (result.Action == policy.ExpectedAction && result.Hostname == policy.ExpectedHostname)
	if *result.Success && metadataMatches {
		return TurnstileValidationDiagnostics{Result: TurnstileValid, ResponseStatus: &status}, nil
	}
	return TurnstileValidationDiagnostics{Result: TurnstileInvalid, ResponseStatus: &status}, nil
}

func IsSafeTurnstileToken(value string) bool {
	if value == "" || len(utf16.Encode([]rune(value))) > maxTurnstileTokenLength {
		return false
	}
	for _, character := range value {
		if character <= 0x20 || character == 0x7f {
			return false
		}
	}
	return true
}
