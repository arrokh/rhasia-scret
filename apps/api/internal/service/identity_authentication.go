package service

import (
	"context"
	"errors"
	"net/http"
	"time"
)

type SessionAssurance string

const (
	AssuranceVerifiedClaims SessionAssurance = "verified-claims"
	AssuranceFreshProvider  SessionAssurance = "fresh-provider-user"
	AssuranceActiveSession  SessionAssurance = "active-session"
)

type Principal struct {
	Issuer           string
	Subject          string
	Email            string
	EmailVerified    bool
	Assurance        SessionAssurance
	SessionID        string
	SessionExpiresAt time.Time
	IssuedAt         time.Time
}

type SessionCredentials struct {
	AuthorizationPresent bool
	CookieHeader         string
	TrustedProxy         bool
}

type SessionVerifier interface {
	Verify(context.Context, SessionCredentials, SessionAssurance) (*Principal, error)
}

type ApplicationUser struct {
	ID     string
	Email  string
	Status string
}

func (user ApplicationUser) CanAccessApplication() bool {
	return user.Status == "ACTIVE"
}

type UserProvisioner interface {
	Provision(context.Context, Principal) (ApplicationUser, error)
}

var ErrCredentialInvalidated = errors.New("application user credential invalidated")

type RateLimitDecision struct {
	Allowed           bool
	RetryAfterSeconds int
}

type RateLimiter interface {
	Consume(context.Context, string, string) (RateLimitDecision, error)
}

type Authenticator struct {
	Sessions    SessionVerifier
	Users       UserProvisioner
	RateLimiter RateLimiter
}

type RequestAuthorization struct {
	Credentials SessionCredentials
	Assurance   SessionAssurance
	Mutation    string
}

type AuthorizationFailure struct {
	Status            int
	Code              string
	RetryAfterSeconds int
}

type AuthorizationResult struct {
	User    *ApplicationUser
	Failure *AuthorizationFailure
}

func (authenticator Authenticator) Authorize(ctx context.Context, request RequestAuthorization) (AuthorizationResult, error) {
	if authenticator.Sessions == nil || authenticator.Users == nil {
		return AuthorizationResult{}, errors.New("application authentication dependencies are unavailable")
	}
	principal, err := authenticator.Sessions.Verify(ctx, request.Credentials, request.Assurance)
	if err != nil {
		return AuthorizationResult{}, err
	}
	if principal == nil || !AssuranceSatisfies(principal.Assurance, request.Assurance) {
		return unauthorized("unauthenticated"), nil
	}

	user, err := authenticator.Users.Provision(ctx, *principal)
	if errors.Is(err, ErrCredentialInvalidated) {
		return unauthorized("unauthenticated"), nil
	}
	if err != nil {
		return AuthorizationResult{}, err
	}
	if user.Status != "ACTIVE" && user.Status != "INACTIVE" {
		return AuthorizationResult{}, errors.New("application user has an invalid status")
	}
	if !user.CanAccessApplication() {
		return AuthorizationResult{Failure: &AuthorizationFailure{Status: http.StatusForbidden, Code: "inactive_user"}}, nil
	}
	if request.Mutation == "" {
		return AuthorizationResult{User: &user}, nil
	}
	if authenticator.RateLimiter == nil {
		return AuthorizationResult{}, errors.New("application mutation rate limiter is unavailable")
	}
	decision, err := authenticator.RateLimiter.Consume(ctx, user.ID, request.Mutation)
	if err != nil {
		return AuthorizationResult{Failure: &AuthorizationFailure{
			Status:            http.StatusServiceUnavailable,
			Code:              "rate_limit_unavailable",
			RetryAfterSeconds: 5,
		}}, nil
	}
	if !decision.Allowed {
		return AuthorizationResult{Failure: &AuthorizationFailure{
			Status:            http.StatusTooManyRequests,
			Code:              "rate_limited",
			RetryAfterSeconds: decision.RetryAfterSeconds,
		}}, nil
	}
	return AuthorizationResult{User: &user}, nil
}

func AssuranceSatisfies(actual SessionAssurance, minimum SessionAssurance) bool {
	rank := map[SessionAssurance]int{
		AssuranceVerifiedClaims: 1,
		AssuranceFreshProvider:  2,
		AssuranceActiveSession:  3,
	}
	return rank[actual] >= rank[minimum] && rank[actual] != 0 && rank[minimum] != 0
}

func unauthorized(code string) AuthorizationResult {
	return AuthorizationResult{Failure: &AuthorizationFailure{Status: http.StatusUnauthorized, Code: code}}
}
