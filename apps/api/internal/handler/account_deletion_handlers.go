package handler

import (
	"time"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

type AccountDeletionHandlers struct {
	preview *PreviewHandlers
	otp     *OTPHandlers
	delete  *DeleteMeHandlers
}

func NewAccountDeletionHandlers(
	authorizer ApplicationUserAuthorizer,
	previewRepository apiService.PreviewRepository,
	otpRepository apiService.PasswordlessOTPRepository,
	otpSender apiService.PasswordlessOTPEmailSender,
	deletionRepository apiService.DeletionRepository,
	completionSender apiService.CompletionEmailSender,
	backend string,
	webOrigin string,
	now func() time.Time,
) *AccountDeletionHandlers {
	return &AccountDeletionHandlers{
		preview: NewPreviewHandlers(authorizer, previewRepository, webOrigin),
		otp:     NewOTPHandlers(authorizer, otpRepository, otpSender, backend, webOrigin, now),
		delete:  NewDeleteMeHandlers(authorizer, deletionRepository, completionSender, webOrigin, now),
	}
}

func (handlers *AccountDeletionHandlers) OperationHandlers() map[string]httpapi.OperationHandler {
	operations := make(map[string]httpapi.OperationHandler, 4)
	for _, group := range []map[string]httpapi.OperationHandler{
		handlers.preview.OperationHandlers(),
		handlers.otp.OperationHandlers(),
		handlers.delete.OperationHandlers(),
	} {
		for operationID, handler := range group {
			operations[operationID] = handler
		}
	}
	return operations
}
