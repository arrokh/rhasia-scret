package handler

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

const workspaceCacheControl = "no-store, private"

type SyncHandlers struct {
	authorizer httpapi.ApplicationUserRequestAuthorizer
	reader     apiService.WorkspaceBundleReader
}

func NewSyncHandlers(authorizer httpapi.ApplicationUserRequestAuthorizer, reader apiService.WorkspaceBundleReader) *SyncHandlers {
	return &SyncHandlers{authorizer: authorizer, reader: reader}
}

func (handlers *SyncHandlers) OperationHandlers() map[string]httpapi.OperationHandler {
	return map[string]httpapi.OperationHandler{
		"getSyncOfflinebundle":   handlers.offlineBundle,
		"getSyncWorkspacebundle": handlers.workspaceBundle,
	}
}

func (handlers *SyncHandlers) offlineBundle(ctx *echo.Context) error {
	user, authorized, err := handlers.authorize(ctx)
	if err != nil || !authorized {
		return err
	}
	if handlers.reader == nil {
		return errors.New("workspace bundle reader is not configured")
	}
	bundle, err := handlers.reader.ReadOnlineWorkspaceBundle(ctx.Request().Context(), user.ID)
	if err != nil {
		return err
	}
	if bundle == nil {
		return syncCacheControlJSON(ctx, http.StatusNotFound, httpapi.ApiError{Error: "not_initialized"}, "no-store")
	}
	etag := fmt.Sprintf("\"%s\"", bundle.SynchronizationToken)
	ctx.Response().Header().Set(echo.HeaderCacheControl, workspaceCacheControl)
	ctx.Response().Header().Set("ETag", etag)
	ctx.Response().Header().Set("X-Synchronized-At", bundle.SynchronizedAt)
	if values := ctx.Request().Header.Values("If-None-Match"); len(values) == 1 && values[0] == etag {
		return ctx.NoContent(http.StatusNotModified)
	}
	return ctx.JSON(http.StatusOK, bundle)
}

func (handlers *SyncHandlers) workspaceBundle(ctx *echo.Context) error {
	user, authorized, err := handlers.authorize(ctx)
	if err != nil || !authorized {
		return err
	}
	if handlers.reader == nil {
		return errors.New("workspace bundle reader is not configured")
	}
	response, err := handlers.reader.ReadAuthorizedWorkspaceResponse(ctx.Request().Context(), user.ID)
	if err != nil {
		return err
	}
	if response == nil {
		return syncCacheControlJSON(ctx, http.StatusNotFound, httpapi.ApiError{Error: "not_initialized"}, "no-store")
	}
	ctx.Response().Header().Set(echo.HeaderCacheControl, workspaceCacheControl)
	ctx.Response().Header().Set("X-Synchronized-At", response.SynchronizedAt)
	return ctx.JSON(http.StatusOK, response)
}

func (handlers *SyncHandlers) authorize(ctx *echo.Context) (apiService.ApplicationUser, bool, error) {
	if handlers.authorizer == nil {
		return apiService.ApplicationUser{}, false, errors.New("application User request authorizer is not configured")
	}
	user, authorized, err := handlers.authorizer.AuthorizeApplicationUserRequest(ctx, "")
	if err != nil || !authorized {
		return apiService.ApplicationUser{}, authorized, err
	}
	if user.ID == "" {
		return apiService.ApplicationUser{}, false, errors.New("application request authorizer returned an incomplete user")
	}
	return user, true, nil
}

func syncCacheControlJSON(ctx *echo.Context, status int, body any, cacheControl string) error {
	ctx.Response().Header().Set(echo.HeaderCacheControl, cacheControl)
	return ctx.JSON(status, body)
}
