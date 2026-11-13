package infrastructure

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	identitymodule "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity"
	vaultapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-management/application"
	vaultmembership "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-membership"
)

type PostgresDestructivePersonalVaultResetRepository struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewPostgresDestructivePersonalVaultResetRepository(pool *pgxpool.Pool, now func() time.Time) (*PostgresDestructivePersonalVaultResetRepository, error) {
	if pool == nil {
		return nil, errors.New("Destructive Personal Vault reset repository is not configured")
	}
	if now == nil {
		now = time.Now
	}
	return &PostgresDestructivePersonalVaultResetRepository{pool: pool, now: now}, nil
}

func (repository *PostgresDestructivePersonalVaultResetRepository) GetEligibility(ctx context.Context, userID string) (vaultapp.DestructivePersonalVaultResetEligibility, error) {
	if userID == "" {
		return vaultapp.DestructivePersonalVaultResetEligibility{}, errors.New("an application user is required for reset eligibility")
	}
	passkeyRecoveryEnrolled, err := identitymodule.HasPasskeyRecoveryCredential(ctx, repository.pool, userID)
	if err != nil {
		return vaultapp.DestructivePersonalVaultResetEligibility{}, err
	}
	rows, err := repository.pool.Query(ctx, `
		SELECT id FROM vaults
		WHERE owner_id = $1 AND type = 'SHARED' AND lifecycle = 'ACTIVE' AND deleted_at IS NULL
		ORDER BY created_at ASC`, userID)
	if err != nil {
		return vaultapp.DestructivePersonalVaultResetEligibility{}, fmt.Errorf("list active owned Shared Vaults for reset eligibility: %w", err)
	}
	defer rows.Close()
	vaultIDs := make([]string, 0)
	for rows.Next() {
		var vaultID string
		if err := rows.Scan(&vaultID); err != nil {
			return vaultapp.DestructivePersonalVaultResetEligibility{}, fmt.Errorf("read active owned Shared Vault: %w", err)
		}
		vaultIDs = append(vaultIDs, vaultID)
	}
	if err := rows.Err(); err != nil {
		return vaultapp.DestructivePersonalVaultResetEligibility{}, fmt.Errorf("iterate active owned Shared Vaults: %w", err)
	}
	return vaultapp.DestructivePersonalVaultResetEligibility{
		PasskeyRecoveryEnrolled:   passkeyRecoveryEnrolled,
		ActiveOwnedSharedVaults:   int64(len(vaultIDs)),
		ActiveOwnedSharedVaultIDs: vaultIDs,
	}, nil
}

func (repository *PostgresDestructivePersonalVaultResetRepository) Reset(ctx context.Context, userID string) error {
	if userID == "" {
		return errors.New("an application user is required for destructive reset")
	}
	transaction, err := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin Destructive Personal Vault reset: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	if _, err := transaction.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, userID); err != nil {
		return fmt.Errorf("lock user for Destructive Personal Vault reset: %w", err)
	}
	passkeyRecoveryEnrolled, err := identitymodule.HasPasskeyRecoveryCredential(ctx, transaction, userID)
	if err != nil {
		return err
	}
	if passkeyRecoveryEnrolled {
		return vaultapp.PasskeyRecoveryAlreadyEnrolledError{}
	}
	var activeOwnedSharedVaults int64
	if err := transaction.QueryRow(ctx, `
		SELECT count(*) FROM vaults
		WHERE owner_id = $1 AND type = 'SHARED' AND lifecycle = 'ACTIVE' AND deleted_at IS NULL`, userID).
		Scan(&activeOwnedSharedVaults); err != nil {
		return fmt.Errorf("count active owned Shared Vaults: %w", err)
	}
	if activeOwnedSharedVaults > 0 {
		return vaultapp.ActiveOwnedSharedVaultsPreventResetError{Count: activeOwnedSharedVaults}
	}
	if err := vaultmembership.LockActiveSharedVaultsForViewer(ctx, transaction, userID); err != nil {
		return err
	}
	var personalVaultID string
	if err := transaction.QueryRow(ctx, `
		SELECT id FROM vaults
		WHERE owner_id = $1 AND type = 'PERSONAL'
		ORDER BY created_at ASC
		LIMIT 1
		FOR UPDATE`, userID).Scan(&personalVaultID); err != nil {
		return fmt.Errorf("load Personal Vault for destructive reset: %w", err)
	}
	var email string
	if err := transaction.QueryRow(ctx, `SELECT email FROM application_users WHERE id = $1`, userID).Scan(&email); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("Personal Vault owner does not exist")
		}
		return fmt.Errorf("load Personal Vault owner for destructive reset: %w", err)
	}
	if _, err := transaction.Exec(ctx, `DELETE FROM authenticator_accounts WHERE vault_id = $1`, personalVaultID); err != nil {
		return fmt.Errorf("delete unusable Personal Vault accounts: %w", err)
	}
	if err := identitymodule.DeleteUserCryptoProfileAndPasskeyChallenges(ctx, transaction, userID); err != nil {
		return err
	}
	if err := vaultmembership.DeletePendingInvitationsForRecipient(ctx, transaction, userID, email); err != nil {
		return err
	}
	now := repository.now()
	if err := vaultmembership.MarkActiveSharedViewerMembershipsLeft(ctx, transaction, userID, now); err != nil {
		return err
	}
	command, err := transaction.Exec(ctx, `
		UPDATE vaults
		SET lifecycle = 'UNINITIALIZED', encrypted_name = NULL, encryption_version = 1,
		    deleted_at = NULL, purge_after = NULL, updated_at = $2
		WHERE id = $1`, personalVaultID, now)
	if err != nil {
		return fmt.Errorf("reset Personal Vault lifecycle: %w", err)
	}
	if command.RowsAffected() != 1 {
		return errors.New("Personal Vault disappeared during destructive reset")
	}
	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit Destructive Personal Vault reset: %w", err)
	}
	return nil
}

var _ vaultapp.DestructivePersonalVaultResetRepository = (*PostgresDestructivePersonalVaultResetRepository)(nil)
