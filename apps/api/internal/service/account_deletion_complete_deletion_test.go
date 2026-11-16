package service

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/localization"
)

type deletionRepositoryStub struct {
	result       DeletionResult
	deleteError  error
	statusErrors map[string]error
	statuses     []string
}

func (repository *deletionRepositoryStub) FindCompletedDeletion(context.Context, string) (*DeletionResult, error) {
	return nil, nil
}

func (repository *deletionRepositoryStub) DeleteUser(context.Context, string, string, DeletionRequest, time.Time) (DeletionResult, error) {
	return repository.result, repository.deleteError
}

func (repository *deletionRepositoryStub) RecordCompletionEmailStatus(_ context.Context, _ string, status string) error {
	repository.statuses = append(repository.statuses, status)
	return repository.statusErrors[status]
}

type completionEmailSenderStub struct {
	err       error
	calls     int
	recipient string
	receiptID string
	locale    localization.Locale
}

func (sender *completionEmailSenderStub) SendDeletionCompletion(_ context.Context, recipient string, receiptID string, locale localization.Locale) error {
	sender.calls++
	sender.recipient = recipient
	sender.receiptID = receiptID
	sender.locale = locale
	return sender.err
}

func TestCompleteDeletionCommitsBeforeBestEffortReceiptEmail(t *testing.T) {
	request := DeletionRequest{Confirmation: DeletionConfirmation, Acknowledged: true, VaultDecisions: []VaultDecision{}}
	repository := &deletionRepositoryStub{result: DeletionResult{ReceiptID: "synthetic-receipt-0001", Email: "owner@example.test"}, statusErrors: map[string]error{}}
	sender := &completionEmailSenderStub{}
	completed, err := CompleteDeletion(context.Background(), repository, sender, "synthetic-user-00001", "synthetic-token", request, localization.Indonesian, time.Unix(1_800_000_000, 0))
	if err != nil || completed.EmailDelivery != "sent" || completed.Deletion.ReceiptID != "synthetic-receipt-0001" {
		t.Fatalf("completed deletion=%#v err=%v", completed, err)
	}
	if sender.calls != 1 || sender.recipient != "owner@example.test" || sender.receiptID != "synthetic-receipt-0001" || !reflect.DeepEqual(repository.statuses, []string{"SENT"}) {
		t.Fatalf("successful completion email boundary mismatch: sender=%#v status=%v", sender, repository.statuses)
	}

	repository = &deletionRepositoryStub{result: DeletionResult{ReceiptID: "synthetic-receipt-0002", Email: "owner@example.test"}, statusErrors: map[string]error{}}
	sender = &completionEmailSenderStub{err: errors.New("synthetic email failure")}
	completed, err = CompleteDeletion(context.Background(), repository, sender, "synthetic-user-00001", "synthetic-token", request, localization.Indonesian, time.Unix(1_800_000_000, 0))
	if err != nil || completed.EmailDelivery != "failed" || completed.Deletion.ReceiptID != "synthetic-receipt-0002" || !reflect.DeepEqual(repository.statuses, []string{"FAILED"}) {
		t.Fatalf("best-effort email failure undid account deletion: result=%#v err=%v statuses=%v", completed, err, repository.statuses)
	}
}

func TestCompleteDeletionMapsEmailStatusPersistenceFailureToFailedWithoutUndoingDeletion(t *testing.T) {
	repository := &deletionRepositoryStub{
		result:       DeletionResult{ReceiptID: "synthetic-receipt-0001", Email: "owner@example.test"},
		statusErrors: map[string]error{"SENT": errors.New("synthetic update failure"), "FAILED": errors.New("synthetic retry failure")},
	}
	sender := &completionEmailSenderStub{}
	completed, err := CompleteDeletion(context.Background(), repository, sender, "synthetic-user-00001", "synthetic-token", DeletionRequest{}, localization.Indonesian, time.Time{})
	if err != nil || completed.EmailDelivery != "failed" || sender.calls != 1 || !reflect.DeepEqual(repository.statuses, []string{"SENT", "FAILED"}) {
		t.Fatalf("receipt status failure changed committed deletion: result=%#v err=%v sender=%#v statuses=%v", completed, err, sender, repository.statuses)
	}
}

func TestCompleteDeletionDoesNotSendEmailWhenRepositoryRejectsDeletion(t *testing.T) {
	repository := &deletionRepositoryStub{deleteError: ErrDeletionPlanStale}
	sender := &completionEmailSenderStub{}
	completed, err := CompleteDeletion(context.Background(), repository, sender, "synthetic-user-00001", "synthetic-token", DeletionRequest{}, localization.Indonesian, time.Time{})
	if !errors.Is(err, ErrDeletionPlanStale) || completed.Deletion.ReceiptID != "" || sender.calls != 0 {
		t.Fatalf("failed deletion sent completion email: result=%#v err=%v sender=%#v", completed, err, sender)
	}
}
