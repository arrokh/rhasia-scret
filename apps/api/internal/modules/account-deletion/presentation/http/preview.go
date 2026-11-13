package http

import (
	"net/http"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/account-deletion/application"
	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity/application"
)

type ApplicationUserAuthorizer interface {
	AuthorizeApplicationUserRequest(*echo.Context, string) (identityapp.ApplicationUser, bool, error)
}

type PreviewHandlers struct {
	authorizer ApplicationUserAuthorizer
	repository application.PreviewRepository
	webOrigin  string
}

func NewPreviewHandlers(authorizer ApplicationUserAuthorizer, repository application.PreviewRepository, webOrigin string) *PreviewHandlers {
	return &PreviewHandlers{authorizer: authorizer, repository: repository, webOrigin: webOrigin}
}

func (handlers *PreviewHandlers) OperationHandlers() map[string]httpapi.OperationHandler {
	return map[string]httpapi.OperationHandler{
		"getMeDeletionPreview": handlers.getPreview,
	}
}

func (handlers *PreviewHandlers) getPreview(ctx *echo.Context) error {
	ctx.Response().Header().Set(echo.HeaderCacheControl, "no-store")
	if !isSameOriginBrowserRequest(ctx.Request(), handlers.webOrigin) {
		return writePreviewError(ctx, http.StatusForbidden, "browser_only")
	}
	if handlers.authorizer == nil {
		return writePreviewError(ctx, http.StatusServiceUnavailable, "deletion_preview_unavailable")
	}
	user, authorized, err := handlers.authorizer.AuthorizeApplicationUserRequest(ctx, "")
	if err != nil || !authorized {
		return err
	}
	if handlers.repository == nil {
		return writePreviewError(ctx, http.StatusServiceUnavailable, "deletion_preview_unavailable")
	}
	preview, err := handlers.repository.GetPreview(ctx.Request().Context(), user.ID)
	if err != nil {
		return writePreviewError(ctx, http.StatusServiceUnavailable, "deletion_preview_unavailable")
	}
	return ctx.JSON(http.StatusOK, preview)
}

func isSameOriginBrowserRequest(request *http.Request, expectedOrigin string) bool {
	if len(request.Header.Values("Authorization")) != 0 || expectedOrigin == "" {
		return false
	}
	origins := request.Header.Values("Origin")
	if len(origins) != 1 {
		return false
	}
	origin, validOrigin := httpapi.NormalizeOrigin(origins[0])
	expected, validExpected := httpapi.NormalizeConfiguredOrigin(expectedOrigin)
	return validOrigin && validExpected && origin == expected
}

func writePreviewError(ctx *echo.Context, status int, code string) error {
	return ctx.JSON(status, httpapi.ApiError{Error: code})
}
