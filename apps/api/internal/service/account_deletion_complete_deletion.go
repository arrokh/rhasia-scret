package service

import (
	"context"
	"errors"
	"time"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/localization"
)

type CompletedDeletion struct {
	Deletion      DeletionResult
	EmailDelivery string
}

func CompleteDeletion(ctx context.Context, repository DeletionRepository, sender CompletionEmailSender, applicationUserID string, authorizationToken string, request DeletionRequest, locale localization.Locale, now time.Time) (CompletedDeletion, error) {
	deletion, err := repository.DeleteUser(ctx, applicationUserID, authorizationToken, request, now)
	if err != nil {
		return CompletedDeletion{}, err
	}
	if sender == nil {
		err = errors.New("account deletion completion email sender is unavailable")
	} else {
		err = sender.SendDeletionCompletion(ctx, deletion.Email, deletion.ReceiptID, localization.ResolveLocale(string(locale)))
	}
	if err == nil {
		err = repository.RecordCompletionEmailStatus(ctx, deletion.ReceiptID, "SENT")
		if err == nil {
			deletion.EmailDelivery = "sent"
			return CompletedDeletion{Deletion: deletion, EmailDelivery: "sent"}, nil
		}
	}
	_ = repository.RecordCompletionEmailStatus(ctx, deletion.ReceiptID, "FAILED")
	deletion.EmailDelivery = "failed"
	return CompletedDeletion{Deletion: deletion, EmailDelivery: "failed"}, nil
}
