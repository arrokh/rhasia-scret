package infrastructure

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

type PostgreSQLQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

type ActiveSharedVault struct {
	ID                       string
	OwnerID                  string
	MembersCanAddAccounts    bool
	MembersCanEditAccounts   bool
	MembersCanDeleteAccounts bool
}

func LockActiveSharedVault(ctx context.Context, transaction PostgreSQLQueryer, vaultID string) (ActiveSharedVault, bool, error) {
	var vault ActiveSharedVault
	err := transaction.QueryRow(ctx, `
		SELECT id, owner_id, members_can_add_accounts, members_can_edit_accounts, members_can_delete_accounts
		FROM vaults
		WHERE id = $1 AND type = 'SHARED' AND lifecycle = 'ACTIVE' AND deleted_at IS NULL
		FOR UPDATE`, vaultID).Scan(
		&vault.ID,
		&vault.OwnerID,
		&vault.MembersCanAddAccounts,
		&vault.MembersCanEditAccounts,
		&vault.MembersCanDeleteAccounts,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return ActiveSharedVault{}, false, nil
	}
	if err != nil {
		return ActiveSharedVault{}, false, fmt.Errorf("lock active Shared Vault: %w", err)
	}
	return vault, true, nil
}

func AssertActivePersonalVault(ctx context.Context, queryer PostgreSQLQueryer, ownerID string, vaultID string) error {
	var exists bool
	if err := queryer.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM vaults
			WHERE id = $1 AND owner_id = $2 AND type = 'PERSONAL' AND lifecycle = 'ACTIVE' AND deleted_at IS NULL
		)`, vaultID, ownerID).Scan(&exists); err != nil {
		return fmt.Errorf("check active Personal Vault access: %w", err)
	}
	if !exists {
		return errors.New("Personal Vault is unavailable")
	}
	return nil
}

func LockActivePersonalVault(ctx context.Context, transaction PostgreSQLQueryer, ownerID string, vaultID string) (int64, bool, error) {
	var encryptionVersion int32
	err := transaction.QueryRow(ctx, `
		SELECT encryption_version
		FROM vaults
		WHERE id = $1 AND owner_id = $2 AND type = 'PERSONAL' AND lifecycle = 'ACTIVE' AND deleted_at IS NULL
		FOR UPDATE`, vaultID, ownerID).Scan(&encryptionVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("lock active Personal Vault: %w", err)
	}
	return int64(encryptionVersion), true, nil
}
