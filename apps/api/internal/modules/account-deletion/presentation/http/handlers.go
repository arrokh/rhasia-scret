package http

import (
	"time"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/account-deletion/application"
)

type Handlers struct {
	preview *PreviewHandlers
	otp     *OTPHandlers
	delete  *DeleteMeHandlers
}

func NewHandlers(
	authorizer ApplicationUserAuthorizer,
	previewRepository application.PreviewRepository,
	otpRepository application.PasswordlessOTPRepository,
	otpSender application.PasswordlessOTPEmailSender,
	deletionRepository application.DeletionRepository,
	completionSender application.CompletionEmailSender,
	backend string,
	webOrigin string,
	now func() time.Time,
) *Handlers {
	return &Handlers{
		preview: NewPreviewHandlers(authorizer, previewRepository, webOrigin),
		otp:     NewOTPHandlers(authorizer, otpRepository, otpSender, backend, webOrigin, now),
		delete:  NewDeleteMeHandlers(authorizer, deletionRepository, completionSender, webOrigin, now),
	}
}

func (handlers *Handlers) OperationHandlers() map[string]httpapi.OperationHandler {
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
