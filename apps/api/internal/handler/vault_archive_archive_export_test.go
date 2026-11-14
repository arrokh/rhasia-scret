package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
)

type archiveExportAuthorizerStub struct {
	ownerID   string
	mutation  string
	allowed   bool
	authorErr error
}

func (authorizer *archiveExportAuthorizerStub) AuthorizeApplicationRequest(_ *echo.Context, mutation string) (string, bool, error) {
	authorizer.mutation = mutation
	return authorizer.ownerID, authorizer.allowed, authorizer.authorErr
}

type archiveExportAuditorStub struct {
	recorded bool
	err      error
	ownerID  string
	vaultID  string
	calls    int
}

func (auditor *archiveExportAuditorStub) RecordArchiveExport(_ context.Context, ownerID string, vaultID string) (bool, error) {
	auditor.calls++
	auditor.ownerID = ownerID
	auditor.vaultID = vaultID
	return auditor.recorded, auditor.err
}

func invokeArchiveExport(t *testing.T, handler httpapi.OperationHandler, contentType string, contentLength string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/v1/vaults/synthetic-vault-0001/archive-exports", nil)
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	if contentLength != "" {
		request.Header.Set("Content-Length", contentLength)
	}
	response := httptest.NewRecorder()
	context := echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault-0001"}})
	if err := handler(context); err != nil {
		t.Fatalf("archive export handler returned error: %v", err)
	}
	return response
}

func TestArchiveExportRequiresFreshMutationAuthorizationAndRecordsActiveOwner(t *testing.T) {
	authorizer := &archiveExportAuthorizerStub{ownerID: "synthetic-user-00001", allowed: true}
	auditor := &archiveExportAuditorStub{recorded: true}
	handler := NewArchiveExportHandlers(authorizer, auditor).OperationHandlers()["postVaultsVaultIdArchiveexports"]
	response := invokeArchiveExport(t, handler, "", "")
	if response.Code != http.StatusNoContent || response.Body.Len() != 0 || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("archive export response=%d body=%q headers=%v", response.Code, response.Body.String(), response.Header())
	}
	if authorizer.mutation != "archive_export" || auditor.calls != 1 || auditor.ownerID != "synthetic-user-00001" || auditor.vaultID != "synthetic-vault-0001" {
		t.Fatalf("archive export dependencies mismatch: authorizer=%#v auditor=%#v", authorizer, auditor)
	}
}

func TestArchiveExportRejectsDeclaredBodyAndMissingOwnership(t *testing.T) {
	for _, test := range []struct {
		name          string
		contentType   string
		contentLength string
		recorded      bool
		wantStatus    int
		wantError     string
		wantAuditCall int
	}{
		{name: "content type declares body", contentType: "application/json", recorded: true, wantStatus: http.StatusBadRequest, wantError: "archive_export_body_forbidden"},
		{name: "nonzero content length", contentLength: "1", recorded: true, wantStatus: http.StatusBadRequest, wantError: "archive_export_body_forbidden"},
		{name: "missing owner access", recorded: false, wantStatus: http.StatusNotFound, wantError: "owner_access_required", wantAuditCall: 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			authorizer := &archiveExportAuthorizerStub{ownerID: "synthetic-user-00001", allowed: true}
			auditor := &archiveExportAuditorStub{recorded: test.recorded}
			handler := NewArchiveExportHandlers(authorizer, auditor).OperationHandlers()["postVaultsVaultIdArchiveexports"]
			response := invokeArchiveExport(t, handler, test.contentType, test.contentLength)
			if response.Code != test.wantStatus || !strings.Contains(response.Body.String(), test.wantError) || auditor.calls != test.wantAuditCall {
				t.Fatalf("archive export error response=%d body=%q auditor=%#v", response.Code, response.Body.String(), auditor)
			}
		})
	}
}

type unreadArchiveBody struct {
	reads int
}

func (body *unreadArchiveBody) Read([]byte) (int, error) {
	body.reads++
	return 0, errors.New("archive request body must not be read")
}

func (body *unreadArchiveBody) Close() error { return nil }

func TestArchiveExportRejectsUnknownLengthBodyWithoutReading(t *testing.T) {
	authorizer := &archiveExportAuthorizerStub{ownerID: "synthetic-user-00001", allowed: true}
	auditor := &archiveExportAuditorStub{recorded: true}
	handler := NewArchiveExportHandlers(authorizer, auditor).OperationHandlers()["postVaultsVaultIdArchiveexports"]
	request := httptest.NewRequest(http.MethodPost, "/v1/vaults/synthetic-vault-0001/archive-exports", nil)
	body := &unreadArchiveBody{}
	request.Body = body
	request.ContentLength = -1
	response := httptest.NewRecorder()
	context := echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault-0001"}})
	if err := handler(context); err != nil {
		t.Fatalf("archive export handler returned error: %v", err)
	}
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "archive_export_body_forbidden") || body.reads != 0 || auditor.calls != 0 {
		t.Fatalf("archive body response=%d body=%q requestReads=%d auditor=%#v", response.Code, response.Body.String(), body.reads, auditor)
	}
}

func TestArchiveExportPropagatesAuditFailuresToSharedHTTPErrorMapping(t *testing.T) {
	authorizer := &archiveExportAuthorizerStub{ownerID: "synthetic-user-00001", allowed: true}
	auditor := &archiveExportAuditorStub{err: errors.New("synthetic database error")}
	handler := NewArchiveExportHandlers(authorizer, auditor).OperationHandlers()["postVaultsVaultIdArchiveexports"]
	request := httptest.NewRequest(http.MethodPost, "/v1/vaults/synthetic-vault-0001/archive-exports", nil)
	response := httptest.NewRecorder()
	context := echo.New().NewContext(request, response)
	if err := handler(context); err == nil {
		t.Fatal("archive audit failure should use the shared HTTP error mapper")
	}
	if response.Body.Len() != 0 || auditor.calls != 1 {
		t.Fatalf("audit failure wrote a partial response: body=%q calls=%d", response.Body.String(), auditor.calls)
	}
}
