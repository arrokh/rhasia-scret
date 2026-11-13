package vaultmembership

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type PostgreSQLQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

type PostgreSQLExecutor interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func LockActiveSharedVaultsForViewer(ctx context.Context, transaction PostgreSQLQueryer, userID string) error {
	rows, err := transaction.Query(ctx, `
		SELECT vault.id
		FROM vault_members AS member
		JOIN vaults AS vault ON vault.id = member.vault_id
		WHERE member.user_id = $1 AND member.role = 'VIEWER' AND member.status = 'ACTIVE'
		  AND vault.type = 'SHARED' AND vault.lifecycle = 'ACTIVE' AND vault.deleted_at IS NULL
		ORDER BY vault.id`, userID)
	if err != nil {
		return fmt.Errorf("list active Shared Vault memberships: %w", err)
	}
	vaultIDs := make([]string, 0)
	for rows.Next() {
		var vaultID string
		if err := rows.Scan(&vaultID); err != nil {
			rows.Close()
			return fmt.Errorf("read active Shared Vault membership: %w", err)
		}
		vaultIDs = append(vaultIDs, vaultID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("iterate active Shared Vault memberships: %w", err)
	}
	rows.Close()
	for _, vaultID := range vaultIDs {
		var lockedID string
		err := transaction.QueryRow(ctx, `SELECT id FROM vaults WHERE id = $1 FOR UPDATE`, vaultID).Scan(&lockedID)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return fmt.Errorf("lock active Shared Vault membership: %w", err)
		}
	}
	return nil
}

func MarkActiveSharedViewerMembershipsLeft(ctx context.Context, executor PostgreSQLExecutor, userID string, now time.Time) error {
	if _, err := executor.Exec(ctx, `
		UPDATE vault_members AS member
		SET status = 'LEFT', encrypted_vault_key = NULL, key_version = NULL,
		    revoked_at = $2, updated_at = $2
		FROM vaults AS vault
		WHERE member.vault_id = vault.id AND member.user_id = $1
		  AND member.role = 'VIEWER' AND member.status = 'ACTIVE' AND vault.type = 'SHARED'`, userID, now); err != nil {
		return fmt.Errorf("leave active Shared Vault memberships: %w", err)
	}
	return nil
}

func DeletePendingInvitationsForRecipient(ctx context.Context, executor PostgreSQLExecutor, userID string, email string) error {
	if _, err := executor.Exec(ctx, `
		DELETE FROM vault_invitations
		WHERE status = 'PENDING'
		  AND (recipient_user_id = $1 OR (recipient_email IS NOT NULL AND lower(recipient_email) = lower($2)))`, userID, email); err != nil {
		return fmt.Errorf("delete pending Secure Share Link invitations: %w", err)
	}
	return nil
}
