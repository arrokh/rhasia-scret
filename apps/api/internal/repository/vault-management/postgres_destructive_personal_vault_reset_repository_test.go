package infrastructure

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	vaultapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/vault-management"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestPostgresDestructivePersonalVaultResetRepositoryIntegration(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	repository, err := NewPostgresDestructivePersonalVaultResetRepository(pool, func() time.Time {
		return time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	})
	if err != nil {
		t.Fatalf("create Destructive Personal Vault reset repository: %v", err)
	}

	t.Run("destroys Personal Vault material and leaves Viewer Vaults intact", func(t *testing.T) {
		userID := testsupport.CreateSyntheticApplicationUser(t, pool)
		sharedOwnerID := testsupport.CreateSyntheticApplicationUser(t, pool)
		personalVaultID := insertSyntheticPersonalVault(t, pool, userID)
		initializer, err := NewPostgresPersonalVaultInitializer(pool, func() time.Time {
			return time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
		})
		if err != nil {
			t.Fatal(err)
		}
		if err := initializer.Initialize(ctx, userID, syntheticPersonalVaultInitialization()); err != nil {
			t.Fatalf("initialize synthetic Personal Vault: %v", err)
		}
		personalAccountID := insertResetAccount(t, pool, personalVaultID)
		if _, err := pool.Exec(ctx, `
			INSERT INTO passkey_recovery_challenges (id, user_id, purpose, challenge, expires_at)
			VALUES ($1, $2, 'REGISTRATION', 'synthetic-challenge', $3)`, mustSyntheticID(t), userID, time.Date(2026, time.January, 3, 3, 4, 5, 0, time.UTC)); err != nil {
			t.Fatalf("insert synthetic pending recovery challenge: %v", err)
		}
		sharedVaultID := insertSyntheticSharedVault(t, pool, sharedOwnerID, userID, true)
		sharedAccountID := insertResetAccount(t, pool, sharedVaultID)
		userEmail := syntheticUserEmail(t, ctx, pool, userID)
		insertResetInvitation(t, pool, sharedVaultID, userID, nil)
		upperEmail := strings.ToUpper(userEmail)
		insertResetInvitation(t, pool, sharedVaultID, nil, upperEmail)

		eligibility, err := repository.GetEligibility(ctx, userID)
		if err != nil {
			t.Fatalf("get synthetic reset eligibility: %v", err)
		}
		if eligibility.PasskeyRecoveryEnrolled || eligibility.ActiveOwnedSharedVaults != 0 || len(eligibility.ActiveOwnedSharedVaultIDs) != 0 {
			t.Fatalf("unexpected synthetic reset eligibility: %#v", eligibility)
		}
		if err := repository.Reset(ctx, userID); err != nil {
			t.Fatalf("destructively reset synthetic Personal Vault: %v", err)
		}

		var personalLifecycle string
		var personalEncryptionVersion int32
		var personalName []byte
		if err := pool.QueryRow(ctx, `SELECT lifecycle, encryption_version, encrypted_name FROM vaults WHERE id = $1`, personalVaultID).
			Scan(&personalLifecycle, &personalEncryptionVersion, &personalName); err != nil {
			t.Fatalf("read reset synthetic Personal Vault: %v", err)
		}
		if personalLifecycle != "UNINITIALIZED" || personalEncryptionVersion != 1 || personalName != nil {
			t.Fatal("destructive reset did not clear encrypted name and restore the uninitialized Personal Vault")
		}
		assertResetRowCount(t, ctx, pool, `SELECT count(*) FROM authenticator_accounts WHERE id = $1`, 0, personalAccountID)
		assertResetRowCount(t, ctx, pool, `SELECT count(*) FROM user_crypto_profiles WHERE user_id = $1`, 0, userID)
		assertResetRowCount(t, ctx, pool, `SELECT count(*) FROM passkey_recovery_challenges WHERE user_id = $1`, 0, userID)
		assertResetRowCount(t, ctx, pool, `SELECT count(*) FROM vault_invitations WHERE status = 'PENDING' AND (recipient_user_id = $1 OR lower(recipient_email) = lower($2))`, 0, userID, userEmail)

		var memberStatus string
		var encryptedVaultKey []byte
		var keyVersion sql.NullInt32
		var revokedAt sql.NullTime
		if err := pool.QueryRow(ctx, `
			SELECT status, encrypted_vault_key, key_version, revoked_at
			FROM vault_members WHERE vault_id = $1 AND user_id = $2`, sharedVaultID, userID).
			Scan(&memberStatus, &encryptedVaultKey, &keyVersion, &revokedAt); err != nil {
			t.Fatalf("read reset Shared Vault Viewer membership: %v", err)
		}
		if memberStatus != "LEFT" || encryptedVaultKey != nil || keyVersion.Valid || !revokedAt.Valid {
			t.Fatal("reset did not leave Shared Vault Viewer membership and clear its obsolete key envelope")
		}
		var sharedLifecycle string
		if err := pool.QueryRow(ctx, `SELECT lifecycle FROM vaults WHERE id = $1`, sharedVaultID).Scan(&sharedLifecycle); err != nil {
			t.Fatalf("read remaining Shared Vault: %v", err)
		}
		if sharedLifecycle != "ACTIVE" {
			t.Fatal("reset changed the Shared Vault lifecycle")
		}
		assertResetRowCount(t, ctx, pool, `SELECT count(*) FROM authenticator_accounts WHERE id = $1`, 1, sharedAccountID)
		assertResetRowCount(t, ctx, pool, `SELECT count(*) FROM vault_members WHERE vault_id = $1 AND user_id = $2 AND role = 'OWNER' AND status = 'ACTIVE'`, 1, sharedVaultID, sharedOwnerID)
	})

	t.Run("rejects reset while the user owns an active Shared Vault", func(t *testing.T) {
		userID := testsupport.CreateSyntheticApplicationUser(t, pool)
		personalVaultID := insertSyntheticPersonalVault(t, pool, userID)
		initializer, err := NewPostgresPersonalVaultInitializer(pool, nil)
		if err != nil {
			t.Fatal(err)
		}
		if err := initializer.Initialize(ctx, userID, syntheticPersonalVaultInitialization()); err != nil {
			t.Fatalf("initialize synthetic Personal Vault: %v", err)
		}
		ownedSharedVaultID := insertSyntheticSharedVault(t, pool, userID, "", false)
		eligibility, err := repository.GetEligibility(ctx, userID)
		if err != nil || eligibility.ActiveOwnedSharedVaults != 1 || len(eligibility.ActiveOwnedSharedVaultIDs) != 1 || eligibility.ActiveOwnedSharedVaultIDs[0] != ownedSharedVaultID {
			t.Fatalf("owned Shared Vault eligibility=%#v err=%v", eligibility, err)
		}
		err = repository.Reset(ctx, userID)
		var blocked vaultapp.ActiveOwnedSharedVaultsPreventResetError
		if !errors.As(err, &blocked) || blocked.Count != 1 {
			t.Fatalf("reset error=%v, want active-owned-Shared-Vault blocker", err)
		}
		assertResetRowCount(t, ctx, pool, `SELECT count(*) FROM user_crypto_profiles WHERE user_id = $1`, 1, userID)
		assertResetRowCount(t, ctx, pool, `SELECT count(*) FROM vaults WHERE id = $1 AND lifecycle = 'UNINITIALIZED'`, 0, personalVaultID)
	})

	t.Run("rejects reset while Passkey-Assisted Recovery is enrolled", func(t *testing.T) {
		userID := testsupport.CreateSyntheticApplicationUser(t, pool)
		personalVaultID := insertSyntheticPersonalVault(t, pool, userID)
		initializer, err := NewPostgresPersonalVaultInitializer(pool, nil)
		if err != nil {
			t.Fatal(err)
		}
		if err := initializer.Initialize(ctx, userID, syntheticPersonalVaultInitialization()); err != nil {
			t.Fatalf("initialize synthetic Personal Vault: %v", err)
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO passkey_recovery_credentials
				(user_id, credential_id, public_key, encrypted_recovery_package, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $5)`, userID, []byte("synthetic-credential"), []byte("synthetic-public-key"), []byte("synthetic-encrypted-package"), time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)); err != nil {
			t.Fatalf("insert synthetic Passkey-Assisted Recovery credential: %v", err)
		}
		eligibility, err := repository.GetEligibility(ctx, userID)
		if err != nil || !eligibility.PasskeyRecoveryEnrolled {
			t.Fatalf("Passkey-Assisted Recovery eligibility=%#v err=%v", eligibility, err)
		}
		err = repository.Reset(ctx, userID)
		var blocked vaultapp.PasskeyRecoveryAlreadyEnrolledError
		if !errors.As(err, &blocked) {
			t.Fatalf("reset error=%v, want enrolled-Passkey-Recovery blocker", err)
		}
		assertResetRowCount(t, ctx, pool, `SELECT count(*) FROM user_crypto_profiles WHERE user_id = $1`, 1, userID)
		assertResetRowCount(t, ctx, pool, `SELECT count(*) FROM vaults WHERE id = $1 AND lifecycle = 'UNINITIALIZED'`, 0, personalVaultID)
	})
}

func insertSyntheticSharedVault(t *testing.T, pool *pgxpool.Pool, ownerID string, viewerID string, includeViewer bool) string {
	t.Helper()
	vaultID := mustSyntheticID(t)
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO vaults (id, type, lifecycle, owner_id, encrypted_name, encryption_version, created_at, updated_at)
		VALUES ($1, 'SHARED', 'ACTIVE', $2, $3, 1, $4, $4)`, vaultID, ownerID, syntheticVaultEnvelope(1, 64), now); err != nil {
		t.Fatalf("insert synthetic Shared Vault: %v", err)
	}
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO vault_members (vault_id, user_id, role, status, encrypted_vault_key, key_version, created_at, updated_at)
		VALUES ($1, $2, 'OWNER', 'ACTIVE', $3, 1, $4, $4)`, vaultID, ownerID, syntheticVaultEnvelope(1, 32), now); err != nil {
		t.Fatalf("insert synthetic Shared Vault owner membership: %v", err)
	}
	if includeViewer {
		if _, err := pool.Exec(context.Background(), `
			INSERT INTO vault_members (vault_id, user_id, role, status, encrypted_vault_key, key_version, created_at, updated_at)
			VALUES ($1, $2, 'VIEWER', 'ACTIVE', $3, 1, $4, $4)`, vaultID, viewerID, syntheticVaultEnvelope(1, 32), now); err != nil {
			t.Fatalf("insert synthetic Shared Vault Viewer membership: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM vault_audit_events WHERE vault_id = $1`, vaultID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM authenticator_accounts WHERE vault_id = $1`, vaultID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM vault_invitations WHERE vault_id = $1`, vaultID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM vault_members WHERE vault_id = $1`, vaultID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM vaults WHERE id = $1`, vaultID)
	})
	return vaultID
}

func insertResetAccount(t *testing.T, pool *pgxpool.Pool, vaultID string) string {
	t.Helper()
	accountID := mustSyntheticID(t)
	payload := syntheticVaultEnvelope(1, 64)
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO authenticator_accounts (id, vault_id, encrypted_payload, encryption_version, revision, created_at, updated_at)
		VALUES ($1, $2, $3, 1, 1, $4, $4)`, accountID, vaultID, payload, now); err != nil {
		t.Fatalf("insert synthetic account for reset test: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM authenticator_accounts WHERE id = $1`, accountID)
	})
	return accountID
}

func insertResetInvitation(t *testing.T, pool *pgxpool.Pool, vaultID string, recipientID any, recipientEmail any) {
	t.Helper()
	id := mustSyntheticID(t)
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO vault_invitations (id, vault_id, recipient_user_id, recipient_email, link_verifier, encrypted_package, status)
		VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')`, id, vaultID, recipientID, recipientEmail, []byte("synthetic-verifier-"+id), syntheticVaultEnvelope(1, 64)); err != nil {
		t.Fatalf("insert synthetic pending Invitation: %v", err)
	}
}

func syntheticUserEmail(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) string {
	t.Helper()
	var email string
	if err := pool.QueryRow(ctx, `SELECT email FROM application_users WHERE id = $1`, userID).Scan(&email); err != nil {
		t.Fatalf("read synthetic Application User email: %v", err)
	}
	return email
}

func assertResetRowCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, query string, expected int64, arguments ...any) {
	t.Helper()
	var count int64
	if err := pool.QueryRow(ctx, query, arguments...).Scan(&count); err != nil {
		t.Fatalf("count synthetic reset rows: %v", err)
	}
	if count != expected {
		t.Fatalf("synthetic reset row count=%d, want %d", count, expected)
	}
}

func mustSyntheticID(t *testing.T) string {
	t.Helper()
	id, err := testsupport.NewSyntheticCUID()
	if err != nil {
		t.Fatalf("generate synthetic reset fixture ID: %v", err)
	}
	return id
}
