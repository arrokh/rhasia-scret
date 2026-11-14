package service

import (
	"context"
	"errors"
	"testing"
)

type destructiveResetRepositoryStub struct {
	userID string
	calls  int
	err    error
}

func (repository *destructiveResetRepositoryStub) GetEligibility(context.Context, string) (DestructivePersonalVaultResetEligibility, error) {
	return DestructivePersonalVaultResetEligibility{}, nil
}

func (repository *destructiveResetRepositoryStub) Reset(_ context.Context, userID string) error {
	repository.calls++
	repository.userID = userID
	return repository.err
}

func TestDestructivelyResetPersonalVaultRequiresUserAndExactConfirmation(t *testing.T) {
	repository := &destructiveResetRepositoryStub{}
	for _, test := range []struct {
		name         string
		userID       string
		confirmation string
		wantError    bool
	}{
		{name: "missing user", confirmation: DestructiveResetConfirmation, wantError: true},
		{name: "wrong confirmation", userID: "synthetic-user", confirmation: "HAPUS DATA BRANKAS ", wantError: true},
		{name: "exact confirmation", userID: "synthetic-user", confirmation: DestructiveResetConfirmation},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := DestructivelyResetPersonalVault(context.Background(), test.userID, test.confirmation, repository)
			if test.wantError && err == nil {
				t.Fatal("invalid reset request succeeded")
			}
			if test.name == "wrong confirmation" {
				var invalid InvalidDestructiveResetConfirmationError
				if !errors.As(err, &invalid) {
					t.Fatalf("wrong confirmation error=%v", err)
				}
			}
		})
	}
	if repository.calls != 1 || repository.userID != "synthetic-user" {
		t.Fatalf("repository received invalid reset attempts: calls=%d user=%q", repository.calls, repository.userID)
	}
}
