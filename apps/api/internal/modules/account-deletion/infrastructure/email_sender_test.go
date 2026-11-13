package infrastructure

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity"
)

type emailDeliveryStub struct {
	err       error
	calls     int
	recipient string
	message   identity.EmailMessage
}

func (delivery *emailDeliveryStub) SendEmail(_ context.Context, recipient string, message identity.EmailMessage) error {
	delivery.calls++
	delivery.recipient = recipient
	delivery.message = message
	return delivery.err
}

func TestAccountDeletionSMTPSenderRendersEnglishOTPEmail(t *testing.T) {
	delivery := &emailDeliveryStub{}
	sender, err := NewSMTPEmailSender(delivery)
	if err != nil {
		t.Fatalf("create account deletion sender: %v", err)
	}
	if err := sender.SendDeletionOTP(context.Background(), "owner@example.test", "001234"); err != nil {
		t.Fatalf("send synthetic account deletion OTP: %v", err)
	}
	if delivery.calls != 1 || delivery.recipient != "owner@example.test" || delivery.message.Subject != deletionOTPEmailSubject {
		t.Fatalf("unexpected deletion email delivery: %#v", delivery)
	}
	if !strings.Contains(delivery.message.Text, "Verification code: 001234") || !strings.Contains(delivery.message.Text, "expires in 10 minutes") ||
		!strings.Contains(delivery.message.HTML, ">001234</p>") || !strings.Contains(delivery.message.HTML, `<html lang="en">`) {
		t.Fatalf("deletion OTP email content did not preserve English template: %#v", delivery.message)
	}
}

func TestAccountDeletionSMTPSenderRejectsInvalidOTPAndMapsDeliveryFailure(t *testing.T) {
	delivery := &emailDeliveryStub{}
	sender, err := NewSMTPEmailSender(delivery)
	if err != nil {
		t.Fatalf("create account deletion sender: %v", err)
	}
	if err := sender.SendDeletionOTP(context.Background(), "owner@example.test", "１２３４５６"); err == nil || delivery.calls != 0 {
		t.Fatalf("sender accepted malformed OTP or attempted delivery: err=%v calls=%d", err, delivery.calls)
	}
	delivery.err = errors.New("synthetic transport failure")
	if err := sender.SendDeletionOTP(context.Background(), "owner@example.test", "001234"); err == nil || err.Error() != "account deletion OTP email delivery failed" || delivery.calls != 1 {
		t.Fatalf("sender leaked delivery error or skipped the send: err=%v calls=%d", err, delivery.calls)
	}
}

func TestAccountDeletionEmailsMatchSharedSyntheticGolden(t *testing.T) {
	fixtureBytes, err := os.ReadFile("../../../../../../packages/api-contract/test-fixtures/email-golden.json")
	if err != nil {
		t.Fatalf("read shared email golden fixture: %v", err)
	}
	var fixture struct {
		AccountDeletionOTP struct {
			Subject string `json:"subject"`
			Text    string `json:"text"`
			HTML    string `json:"html"`
		} `json:"accountDeletionOtp"`
		AccountDeletionCompletion struct {
			Subject string `json:"subject"`
			Text    string `json:"text"`
			HTML    string `json:"html"`
		} `json:"accountDeletionCompletion"`
	}
	if err := json.Unmarshal(fixtureBytes, &fixture); err != nil {
		t.Fatalf("decode shared email golden fixture: %v", err)
	}
	otp := renderDeletionOTPEmail("001234")
	if otp.Subject != fixture.AccountDeletionOTP.Subject || otp.Text != fixture.AccountDeletionOTP.Text || otp.HTML != fixture.AccountDeletionOTP.HTML {
		t.Fatalf("Go account-deletion OTP email differs from the shared TypeScript rendering fixture (subject=%t text=%t html=%t; %s)", otp.Subject == fixture.AccountDeletionOTP.Subject, otp.Text == fixture.AccountDeletionOTP.Text, otp.HTML == fixture.AccountDeletionOTP.HTML, emailGoldenDifference(otp.HTML, fixture.AccountDeletionOTP.HTML))
	}
	completion := renderDeletionCompletionEmail("synthetic-receipt-id")
	if completion.Subject != fixture.AccountDeletionCompletion.Subject || completion.Text != fixture.AccountDeletionCompletion.Text || completion.HTML != fixture.AccountDeletionCompletion.HTML {
		t.Fatalf("Go account-deletion completion email differs from the shared TypeScript rendering fixture (subject=%t text=%t html=%t; %s)", completion.Subject == fixture.AccountDeletionCompletion.Subject, completion.Text == fixture.AccountDeletionCompletion.Text, completion.HTML == fixture.AccountDeletionCompletion.HTML, emailGoldenDifference(completion.HTML, fixture.AccountDeletionCompletion.HTML))
	}
}

func emailGoldenDifference(actual string, expected string) string {
	index := 0
	for index < len(actual) && index < len(expected) && actual[index] == expected[index] {
		index++
	}
	start := max(0, index-48)
	actualEnd := min(len(actual), index+96)
	expectedEnd := min(len(expected), index+96)
	return fmt.Sprintf("first difference at byte %d: actual=%q expected=%q", index, actual[start:actualEnd], expected[start:expectedEnd])
}

func TestAccountDeletionCompletionEmailIncludesOnlyEnglishReceipt(t *testing.T) {
	message := renderDeletionCompletionEmail("synthetic-receipt-id")
	if message.Subject != deletionCompletionEmailSubject || !strings.Contains(message.Text, "Receipt ID: synthetic-receipt-id") ||
		!strings.Contains(message.HTML, "synthetic-receipt-id") || !strings.Contains(message.Text, "This email contains your receipt only.") {
		t.Fatalf("completion email differs from English receipt contract: %#v", message)
	}
}
