package application

import (
	"context"
	"errors"
	"net/http"
	"testing"
)

type sessionVerifierStub struct {
	principal *Principal
	err       error
	calls     int
}

func (stub *sessionVerifierStub) Verify(context.Context, SessionCredentials, SessionAssurance) (*Principal, error) {
	stub.calls++
	return stub.principal, stub.err
}

type userProvisionerStub struct {
	user  ApplicationUser
	err   error
	calls int
}

func (stub *userProvisionerStub) Provision(context.Context, Principal) (ApplicationUser, error) {
	stub.calls++
	return stub.user, stub.err
}

type rateLimiterStub struct {
	decision RateLimitDecision
	err      error
	calls    int
}

func (stub *rateLimiterStub) Consume(context.Context, string, string) (RateLimitDecision, error) {
	stub.calls++
	return stub.decision, stub.err
}

func TestAuthenticatorReaderAndMutationOrdering(t *testing.T) {
	t.Parallel()

	principal := &Principal{Issuer: "rhasia:passwordless", Subject: "synthetic-subject", Email: "test@example.test", EmailVerified: true, Assurance: AssuranceActiveSession}
	users := &userProvisionerStub{user: ApplicationUser{ID: "synthetic-user", Email: "test@example.test", Status: "ACTIVE"}}
	limiter := &rateLimiterStub{decision: RateLimitDecision{Allowed: true}}
	authenticator := Authenticator{Sessions: &sessionVerifierStub{principal: principal}, Users: users, RateLimiter: limiter}

	reader, err := authenticator.Authorize(context.Background(), RequestAuthorization{Assurance: AssuranceFreshProvider})
	if err != nil || reader.User == nil || reader.Failure != nil {
		t.Fatalf("reader authorization = %#v, %v; want allowed", reader, err)
	}
	if limiter.calls != 0 {
		t.Fatalf("reader consumed %d mutation limits; want 0", limiter.calls)
	}

	mutation, err := authenticator.Authorize(context.Background(), RequestAuthorization{Assurance: AssuranceFreshProvider, Mutation: "account_mutation"})
	if err != nil || mutation.User == nil || mutation.Failure != nil {
		t.Fatalf("mutation authorization = %#v, %v; want allowed", mutation, err)
	}
	if limiter.calls != 1 {
		t.Fatalf("mutation consumed %d rate limits; want 1", limiter.calls)
	}
}

func TestAuthenticatorMapsSessionAndUserFailures(t *testing.T) {
	t.Parallel()

	t.Run("missing session", func(t *testing.T) {
		t.Parallel()
		authenticator := Authenticator{Sessions: &sessionVerifierStub{}, Users: &userProvisionerStub{}}
		result, err := authenticator.Authorize(context.Background(), RequestAuthorization{Assurance: AssuranceFreshProvider})
		if err != nil || result.Failure == nil || result.Failure.Status != http.StatusUnauthorized || result.Failure.Code != "unauthenticated" {
			t.Fatalf("authorization = %#v, %v; want unauthenticated", result, err)
		}
	})

	t.Run("inactive user", func(t *testing.T) {
		t.Parallel()
		authenticator := Authenticator{
			Sessions: &sessionVerifierStub{principal: &Principal{Assurance: AssuranceActiveSession}},
			Users:    &userProvisionerStub{user: ApplicationUser{ID: "synthetic-user", Status: "INACTIVE"}},
		}
		result, err := authenticator.Authorize(context.Background(), RequestAuthorization{Assurance: AssuranceFreshProvider})
		if err != nil || result.Failure == nil || result.Failure.Status != http.StatusForbidden || result.Failure.Code != "inactive_user" {
			t.Fatalf("authorization = %#v, %v; want inactive_user", result, err)
		}
	})

	t.Run("invalidated credential", func(t *testing.T) {
		t.Parallel()
		authenticator := Authenticator{
			Sessions: &sessionVerifierStub{principal: &Principal{Assurance: AssuranceActiveSession}},
			Users:    &userProvisionerStub{err: ErrCredentialInvalidated},
		}
		result, err := authenticator.Authorize(context.Background(), RequestAuthorization{Assurance: AssuranceFreshProvider})
		if err != nil || result.Failure == nil || result.Failure.Status != http.StatusUnauthorized {
			t.Fatalf("authorization = %#v, %v; want unauthenticated", result, err)
		}
	})

	t.Run("session store failure", func(t *testing.T) {
		t.Parallel()
		authenticator := Authenticator{Sessions: &sessionVerifierStub{err: errors.New("synthetic database failure")}, Users: &userProvisionerStub{}}
		if _, err := authenticator.Authorize(context.Background(), RequestAuthorization{Assurance: AssuranceFreshProvider}); err == nil {
			t.Fatal("Authorize() error = nil; want propagated dependency failure")
		}
	})
}

func TestAuthenticatorMutationRateLimitOutcomes(t *testing.T) {
	t.Parallel()

	principal := &Principal{Assurance: AssuranceActiveSession}
	request := RequestAuthorization{Assurance: AssuranceFreshProvider, Mutation: "account_mutation"}

	t.Run("limited", func(t *testing.T) {
		t.Parallel()
		authenticator := Authenticator{Sessions: &sessionVerifierStub{principal: principal}, Users: &userProvisionerStub{user: ApplicationUser{ID: "synthetic-user", Status: "ACTIVE"}}, RateLimiter: &rateLimiterStub{decision: RateLimitDecision{Allowed: false, RetryAfterSeconds: 17}}}
		result, err := authenticator.Authorize(context.Background(), request)
		if err != nil || result.Failure == nil || result.Failure.Status != http.StatusTooManyRequests || result.Failure.Code != "rate_limited" || result.Failure.RetryAfterSeconds != 17 {
			t.Fatalf("authorization = %#v, %v; want bounded rate-limit result", result, err)
		}
	})

	t.Run("unavailable", func(t *testing.T) {
		t.Parallel()
		authenticator := Authenticator{Sessions: &sessionVerifierStub{principal: principal}, Users: &userProvisionerStub{user: ApplicationUser{ID: "synthetic-user", Status: "ACTIVE"}}, RateLimiter: &rateLimiterStub{err: errors.New("synthetic storage failure")}}
		result, err := authenticator.Authorize(context.Background(), request)
		if err != nil || result.Failure == nil || result.Failure.Status != http.StatusServiceUnavailable || result.Failure.Code != "rate_limit_unavailable" || result.Failure.RetryAfterSeconds != 5 {
			t.Fatalf("authorization = %#v, %v; want rate-limit unavailable", result, err)
		}
	})
}

func TestAssuranceSatisfiesUsesEstablishedAssuranceOrdering(t *testing.T) {
	t.Parallel()

	cases := []struct {
		actual  SessionAssurance
		minimum SessionAssurance
		want    bool
	}{
		{actual: AssuranceActiveSession, minimum: AssuranceFreshProvider, want: true},
		{actual: AssuranceFreshProvider, minimum: AssuranceActiveSession, want: false},
		{actual: AssuranceVerifiedClaims, minimum: AssuranceFreshProvider, want: false},
		{actual: "unknown", minimum: AssuranceFreshProvider, want: false},
		{actual: AssuranceActiveSession, minimum: "unknown", want: false},
	}
	for _, testCase := range cases {
		if got := AssuranceSatisfies(testCase.actual, testCase.minimum); got != testCase.want {
			t.Errorf("AssuranceSatisfies(%q, %q) = %t; want %t", testCase.actual, testCase.minimum, got, testCase.want)
		}
	}
}
