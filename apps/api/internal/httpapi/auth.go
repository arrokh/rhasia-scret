package httpapi

import (
	"strconv"

	"github.com/labstack/echo/v5"

	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/identity"
)

type ApplicationRequestAuthorizer interface {
	AuthorizeApplicationRequest(*echo.Context, string) (string, bool, error)
}

type ApplicationUserRequestAuthorizer interface {
	AuthorizeApplicationUserRequest(*echo.Context, string) (identityapp.ApplicationUser, bool, error)
}

func AuthenticateApplicationReader(ctx *echo.Context, authenticator identityapp.Authenticator, assurance identityapp.SessionAssurance) (*identityapp.ApplicationUser, error) {
	return authenticateApplicationRequest(ctx, authenticator, assurance, "")
}

func AuthenticateApplicationMutation(ctx *echo.Context, authenticator identityapp.Authenticator, operation string, assurance identityapp.SessionAssurance) (*identityapp.ApplicationUser, error) {
	return authenticateApplicationRequest(ctx, authenticator, assurance, operation)
}

func authenticateApplicationRequest(ctx *echo.Context, authenticator identityapp.Authenticator, assurance identityapp.SessionAssurance, operation string) (*identityapp.ApplicationUser, error) {
	request := ctx.Request()
	result, err := authenticator.Authorize(request.Context(), identityapp.RequestAuthorization{
		Credentials: identityapp.SessionCredentials{
			AuthorizationPresent: len(request.Header.Values("Authorization")) > 0,
			CookieHeader:         request.Header.Get("Cookie"),
			TrustedProxy:         IsProxyRequest(ctx),
		},
		Assurance: assurance,
		Mutation:  operation,
	})
	if err != nil {
		return nil, err
	}
	if result.Failure != nil {
		if result.Failure.RetryAfterSeconds > 0 {
			ctx.Response().Header().Set("Retry-After", strconv.Itoa(result.Failure.RetryAfterSeconds))
		}
		if err := ctx.JSON(result.Failure.Status, ApiError{Error: result.Failure.Code}); err != nil {
			return nil, err
		}
		return nil, nil
	}
	return result.User, nil
}
