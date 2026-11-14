package handler

import (
	"context"
	"errors"
	"net/http"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
)

type ArchiveExportAuditor interface {
	RecordArchiveExport(context.Context, string, string) (bool, error)
}

type ArchiveExportHandlers struct {
	authorizer httpapi.ApplicationRequestAuthorizer
	auditor    ArchiveExportAuditor
}

func NewArchiveExportHandlers(authorizer httpapi.ApplicationRequestAuthorizer, auditor ArchiveExportAuditor) *ArchiveExportHandlers {
	return &ArchiveExportHandlers{authorizer: authorizer, auditor: auditor}
}

func (handlers *ArchiveExportHandlers) OperationHandlers() map[string]httpapi.OperationHandler {
	return map[string]httpapi.OperationHandler{"postVaultsVaultIdArchiveexports": handlers.recordArchiveExport}
}

func (handlers *ArchiveExportHandlers) recordArchiveExport(ctx *echo.Context) error {
	if handlers.authorizer == nil {
		return errors.New("application request authorizer is unavailable")
	}
	ownerID, authorized, err := handlers.authorizer.AuthorizeApplicationRequest(ctx, "archive_export")
	if err != nil || !authorized {
		return err
	}
	if requestDeclaresContent(ctx.Request()) {
		return ctx.JSON(http.StatusBadRequest, httpapi.ApiError{Error: "archive_export_body_forbidden"})
	}
	if handlers.auditor == nil {
		return errors.New("Vault archive export auditor is unavailable")
	}
	recorded, err := handlers.auditor.RecordArchiveExport(ctx.Request().Context(), ownerID, ctx.Param("vaultId"))
	if err != nil {
		return err
	}
	if !recorded {
		return ctx.JSON(http.StatusNotFound, httpapi.ApiError{Error: "owner_access_required"})
	}
	ctx.Response().Header().Set(echo.HeaderCacheControl, "no-store")
	return ctx.NoContent(http.StatusNoContent)
}

func requestDeclaresContent(request *http.Request) bool {
	if request.Body != nil && request.Body != http.NoBody {
		return true
	}
	if len(request.Header.Values("Content-Type")) > 0 {
		return true
	}
	contentLengths := request.Header.Values("Content-Length")
	if len(contentLengths) == 0 {
		return false
	}
	return len(contentLengths) != 1 || contentLengths[0] != "0"
}
