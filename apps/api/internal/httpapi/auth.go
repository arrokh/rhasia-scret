package httpapi

import (
	"strconv"

	"github.com/labstack/echo/v5"

	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

type ApplicationRequestAuthorizer interface {
	AuthorizeApplicationRequest(*echo.Context, string) (string, bool, error)
}

type ApplicationUserRequestAuthorizer interface {
	AuthorizeApplicationUserRequest(*echo.Context, string) (apiService.ApplicationUser, bool, error)
}

func AuthenticateApplicationReader(ctx *echo.Context, authenticator apiService.Authenticator, assurance apiService.SessionAssurance) (*apiService.ApplicationUser, error) {
	return authenticateApplicationRequest(ctx, authenticator, assurance, "")
}

func AuthenticateApplicationMutation(ctx *echo.Context, authenticator apiService.Authenticator, operation string, assurance apiService.SessionAssurance) (*apiService.ApplicationUser, error) {
	return authenticateApplicationRequest(ctx, authenticator, assurance, operation)
}

func authenticateApplicationRequest(ctx *echo.Context, authenticator apiService.Authenticator, assurance apiService.SessionAssurance, operation string) (*apiService.ApplicationUser, error) {
	request := ctx.Request()
	result, err := authenticator.Authorize(request.Context(), apiService.RequestAuthorization{
		Credentials: apiService.SessionCredentials{
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
