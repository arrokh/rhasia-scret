package service

import (
	"context"
	"errors"
	"fmt"
)

const DestructiveResetConfirmation = "HAPUS DATA BRANKAS"

type DestructivePersonalVaultResetEligibility struct {
	PasskeyRecoveryEnrolled   bool     `json:"passkeyRecoveryEnrolled"`
	ActiveOwnedSharedVaults   int64    `json:"activeOwnedSharedVaults"`
	ActiveOwnedSharedVaultIDs []string `json:"activeOwnedSharedVaultIds"`
}

type DestructivePersonalVaultResetRepository interface {
	GetEligibility(context.Context, string) (DestructivePersonalVaultResetEligibility, error)
	Reset(context.Context, string) error
}

type InvalidDestructiveResetConfirmationError struct{}

func (InvalidDestructiveResetConfirmationError) Error() string {
	return "destructive reset confirmation does not match"
}

type PasskeyRecoveryAlreadyEnrolledError struct{}

func (PasskeyRecoveryAlreadyEnrolledError) Error() string {
	return "passkey recovery is available"
}

type ActiveOwnedSharedVaultsPreventResetError struct {
	Count int64
}

func (failure ActiveOwnedSharedVaultsPreventResetError) Error() string {
	return fmt.Sprintf("%d active owned Shared Vaults prevent destructive reset", failure.Count)
}

func DestructivelyResetPersonalVault(ctx context.Context, userID string, confirmation string, repository DestructivePersonalVaultResetRepository) error {
	if userID == "" {
		return errors.New("an application user is required for destructive reset")
	}
	if confirmation != DestructiveResetConfirmation {
		return InvalidDestructiveResetConfirmationError{}
	}
	if repository == nil {
		return errors.New("Destructive Personal Vault reset is unavailable")
	}
	return repository.Reset(ctx, userID)
}
