package infrastructure

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity"
	vaultapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-management/application"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestPostgresVaultKeyRotationSnapshotAndCompareAndSwap(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.April, 5, 6, 7, 8, 0, time.UTC)
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	memberID := testsupport.CreateSyntheticApplicationUser(t, pool)
	vaultID := insertRecoveryVault(t, ctx, pool, ownerID, "ACTIVE", nil, nil, now)
	if _, err := pool.Exec(ctx, `
		INSERT INTO vault_members (vault_id, user_id, role, status, encrypted_vault_key, key_version, created_at, updated_at)
		VALUES ($1, $2, 'VIEWER', 'ACTIVE', $3, 1, $4, $4)`, vaultID, memberID, []byte("synthetic-member-key-wrap"), now); err != nil {
		t.Fatalf("insert synthetic rotation member: %v", err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, `DELETE FROM vault_invitations WHERE vault_id = $1`, vaultID); err != nil {
			t.Errorf("delete synthetic rotation invitations: %v", err)
		}
		deleteSyntheticSharedVault(t, ctx, pool, vaultID)
	})
	ownerKey := syntheticPublicEncryptionKey(t, "A")
	memberKey := syntheticPublicEncryptionKey(t, "C")
	insertSyntheticCryptoProfile(t, ctx, pool, ownerID, ownerKey, now)
	insertSyntheticCryptoProfile(t, ctx, pool, memberID, memberKey, now)

	activeAccountID := mustRotationID(t)
	deletedAccountID := mustRotationID(t)
	activePayload := []byte("synthetic-active-encrypted-account-payload")
	deletedPayload := []byte("synthetic-deleted-encrypted-account-payload")
	deletedAt := now.Add(-24 * time.Hour)
	if _, err := pool.Exec(ctx, `
		INSERT INTO authenticator_accounts (id, vault_id, encrypted_payload, encryption_version, revision, created_at, updated_at)
		VALUES ($1, $2, $3, 1, 3, $4, $4)`, activeAccountID, vaultID, activePayload, now); err != nil {
		t.Fatalf("insert synthetic active rotation account: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO authenticator_accounts (id, vault_id, encrypted_payload, encryption_version, revision, deleted_at, purge_after, created_at, updated_at)
		VALUES ($1, $2, $3, 1, 4, $4, $5, $6, $6)`,
		deletedAccountID, vaultID, deletedPayload, deletedAt, deletedAt.Add(30*24*time.Hour), now); err != nil {
		t.Fatalf("insert synthetic recoverable deleted rotation account: %v", err)
	}
	insertRotationInvitation(t, ctx, pool, vaultID, now.Add(24*time.Hour))
	insertRotationInvitation(t, ctx, pool, vaultID, now.Add(-time.Hour))

	repository, err := NewPostgresVaultKeyRotationRepository(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create Vault key rotation repository: %v", err)
	}
	snapshot, err := repository.Snapshot(ctx, ownerID, vaultID)
	if err != nil || snapshot == nil {
		t.Fatalf("read Shared Vault rotation snapshot: snapshot=%#v err=%v", snapshot, err)
	}
	if snapshot.VaultID != vaultID || string(snapshot.EncryptedName) != "synthetic-encrypted-name" || snapshot.EncryptionVersion != 1 ||
		snapshot.CurrentKeyVersion == nil || *snapshot.CurrentKeyVersion != 1 || snapshot.PendingInvitationCount != 1 ||
		len(snapshot.Accounts) != 2 || len(snapshot.Members) != 2 {
		var currentKeyVersion any
		if snapshot.CurrentKeyVersion != nil {
			currentKeyVersion = *snapshot.CurrentKeyVersion
		}
		t.Fatalf("unexpected Shared Vault rotation snapshot: vaultId=%q expectedVaultId=%q name=%q encryptionVersion=%d currentKeyVersion=%v pendingInvitations=%d accounts=%d members=%d",
			snapshot.VaultID, vaultID, string(snapshot.EncryptedName), snapshot.EncryptionVersion, currentKeyVersion,
			snapshot.PendingInvitationCount, len(snapshot.Accounts), len(snapshot.Members))
	}
	accountsByID := make(map[string]vaultapp.VaultKeyRotationAccountSnapshot, len(snapshot.Accounts))
	for _, account := range snapshot.Accounts {
		accountsByID[account.ID] = account
	}
	activeSnapshot := accountsByID[activeAccountID]
	deletedSnapshot := accountsByID[deletedAccountID]
	if activeSnapshot.Revision != 3 || activeSnapshot.DeletedAt != nil || deletedSnapshot.Revision != 4 || deletedSnapshot.DeletedAt == nil || !deletedSnapshot.DeletedAt.Equal(deletedAt) {
		t.Fatalf("rotation snapshot account retention state differs: %#v", snapshot.Accounts)
	}
	membersByID := make(map[string]vaultapp.VaultKeyRotationMemberSnapshot, len(snapshot.Members))
	for _, member := range snapshot.Members {
		membersByID[member.UserID] = member
	}
	ownerSnapshot := membersByID[ownerID]
	memberSnapshot := membersByID[memberID]
	if ownerSnapshot.KeyVersion == nil || *ownerSnapshot.KeyVersion != 1 || memberSnapshot.KeyVersion == nil || *memberSnapshot.KeyVersion != 1 ||
		ownerSnapshot.PublicKey == nil || !identity.PublicEncryptionKeysEqual(*ownerSnapshot.PublicKey, ownerKey) ||
		memberSnapshot.PublicKey == nil || !identity.PublicEncryptionKeysEqual(*memberSnapshot.PublicKey, memberKey) {
		t.Fatalf("rotation snapshot member identities differ: %#v", snapshot.Members)
	}

	rotation := vaultapp.VaultKeyRotation{
		ExpectedEncryptedName: []byte("synthetic-encrypted-name"),
		EncryptedName:         []byte("synthetic-rotated-encrypted-vault-name"),
		EncryptionVersion:     1,
		ExpectedKeyVersion:    1,
		KeyVersion:            2,
		Accounts: []vaultapp.VaultKeyRotationAccountReplacement{
			{ID: activeAccountID, Revision: 3, EncryptedPayload: []byte("synthetic-rotated-active-payload")},
			{ID: deletedAccountID, Revision: 4, EncryptedPayload: []byte("synthetic-rotated-deleted-payload")},
		},
		MemberPackages: []vaultapp.VaultKeyRotationMemberPackage{
			{UserID: ownerID, ExpectedPublicKey: ownerKey, EncryptedVaultKey: []byte("synthetic-rotated-owner-key-wrap")},
			{UserID: memberID, ExpectedPublicKey: memberKey, EncryptedVaultKey: []byte("synthetic-rotated-member-key-wrap")},
		},
	}
	staleRotation := rotation
	staleRotation.MemberPackages = append([]vaultapp.VaultKeyRotationMemberPackage(nil), rotation.MemberPackages...)
	staleRotation.MemberPackages[1].ExpectedPublicKey = syntheticPublicEncryptionKey(t, "E")
	if rotated, err := repository.Rotate(ctx, ownerID, vaultID, staleRotation); err != nil || rotated {
		t.Fatalf("rotation with a stale member public key=%t err=%v; want rejected", rotated, err)
	}
	if rotated, err := repository.Rotate(ctx, ownerID, vaultID, rotation); err != nil || !rotated {
		t.Fatalf("rotate Shared Vault key and encrypted contents=%t err=%v", rotated, err)
	}
	if rotated, err := repository.Rotate(ctx, ownerID, vaultID, rotation); err != nil || rotated {
		t.Fatalf("replayed stale Shared Vault rotation=%t err=%v; want rejected", rotated, err)
	}

	var encryptedName []byte
	var encryptionVersion int32
	if err := pool.QueryRow(ctx, `SELECT encrypted_name, encryption_version FROM vaults WHERE id = $1`, vaultID).Scan(&encryptedName, &encryptionVersion); err != nil ||
		string(encryptedName) != string(rotation.EncryptedName) || encryptionVersion != 1 {
		t.Fatalf("rotated Shared Vault name=%q version=%d err=%v", encryptedName, encryptionVersion, err)
	}
	for _, expected := range rotation.MemberPackages {
		var encryptedKey []byte
		var keyVersion int32
		if err := pool.QueryRow(ctx, `SELECT encrypted_vault_key, key_version FROM vault_members WHERE vault_id = $1 AND user_id = $2`, vaultID, expected.UserID).
			Scan(&encryptedKey, &keyVersion); err != nil || string(encryptedKey) != string(expected.EncryptedVaultKey) || keyVersion != 2 {
			t.Fatalf("rotated member %q key wrap=%q version=%d err=%v", expected.UserID, encryptedKey, keyVersion, err)
		}
	}
	for _, expected := range rotation.Accounts {
		var payload []byte
		var revision int32
		if err := pool.QueryRow(ctx, `SELECT encrypted_payload, revision FROM authenticator_accounts WHERE id = $1`, expected.ID).
			Scan(&payload, &revision); err != nil || string(payload) != string(expected.EncryptedPayload) || int64(revision) != expected.Revision+1 {
			t.Fatalf("rotated account %q payload=%q revision=%d err=%v", expected.ID, payload, revision, err)
		}
	}
	var pendingInvitationCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM vault_invitations WHERE vault_id = $1 AND status = 'PENDING'`, vaultID).Scan(&pendingInvitationCount); err != nil || pendingInvitationCount != 0 {
		t.Fatalf("pending invitations after rotation=%d err=%v; want all invalidated", pendingInvitationCount, err)
	}
	var rotationAuditCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM vault_audit_events WHERE vault_id = $1 AND event_type = 'VAULT_KEY_ROTATED' AND owner_id = $2 AND actor_user_id = $2`, vaultID, ownerID).
		Scan(&rotationAuditCount); err != nil || rotationAuditCount != 1 {
		t.Fatalf("Shared Vault rotation audit count=%d err=%v; want one owner event", rotationAuditCount, err)
	}

	rotatedSnapshot, err := repository.Snapshot(ctx, ownerID, vaultID)
	if err != nil || rotatedSnapshot == nil || rotatedSnapshot.CurrentKeyVersion == nil || *rotatedSnapshot.CurrentKeyVersion != 2 ||
		rotatedSnapshot.PendingInvitationCount != 0 || len(rotatedSnapshot.Accounts) != 2 {
		t.Fatalf("read post-rotation snapshot: snapshot=%#v err=%v", rotatedSnapshot, err)
	}
}

func TestPostgresVaultKeyRotationRejectsOversizedSetsWithBoundedLocks(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.April, 5, 6, 7, 8, 0, time.UTC)
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	repository, err := NewPostgresVaultKeyRotationRepository(pool, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create Vault key rotation repository: %v", err)
	}
	rotation := vaultapp.VaultKeyRotation{
		ExpectedEncryptedName: []byte("synthetic-encrypted-name"),
		ExpectedKeyVersion:    1,
		KeyVersion:            2,
		EncryptionVersion:     1,
	}

	accountVaultID := insertRecoveryVault(t, ctx, pool, ownerID, "ACTIVE", nil, nil, now)
	t.Cleanup(func() { deleteSyntheticSharedVault(t, ctx, pool, accountVaultID) })
	accountPrefix := "synthetic-rotation-account-" + mustRotationID(t)
	if _, err := pool.Exec(ctx, `
		INSERT INTO authenticator_accounts (id, vault_id, encrypted_payload, encryption_version, revision, created_at, updated_at)
		SELECT $1 || '-' || lpad(series::text, 4, '0'), $2, decode(repeat('00', 29), 'hex'), 1, 1, $3, $3
		FROM generate_series(1, 502) AS series`, accountPrefix, accountVaultID, now); err != nil {
		t.Fatalf("insert synthetic oversized rotation account set: %v", err)
	}
	accountBlocker, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin oversized-account blocker transaction: %v", err)
	}
	defer func() { _ = accountBlocker.Rollback(ctx) }()
	blockedAccountID := fmt.Sprintf("%s-%04d", accountPrefix, 502)
	var lockedAccountID string
	if err := accountBlocker.QueryRow(ctx, `SELECT id FROM authenticator_accounts WHERE id = $1 FOR UPDATE`, blockedAccountID).Scan(&lockedAccountID); err != nil {
		t.Fatalf("lock account beyond overflow cap: %v", err)
	}
	boundedContext, cancel := context.WithTimeout(ctx, 2*time.Second)
	rotated, err := repository.Rotate(boundedContext, ownerID, accountVaultID, rotation)
	cancel()
	if err != nil || rotated {
		t.Fatalf("oversized account rotation=%t err=%v; want bounded rejection without blocking on account 502", rotated, err)
	}
	if err := accountBlocker.Rollback(ctx); err != nil {
		t.Fatalf("release oversized-account blocker: %v", err)
	}

	memberVaultID := insertRecoveryVault(t, ctx, pool, ownerID, "ACTIVE", nil, nil, now)
	memberPrefix := "synthetic-rotation-member-" + mustRotationID(t)
	memberEmailPrefix := "rotation-" + mustRotationID(t)
	t.Cleanup(func() {
		deleteSyntheticSharedVault(t, ctx, pool, memberVaultID)
		if _, err := pool.Exec(ctx, `DELETE FROM application_users WHERE id LIKE $1 || '-%'`, memberPrefix); err != nil {
			t.Errorf("delete synthetic rotation member users: %v", err)
		}
	})
	if _, err := pool.Exec(ctx, `
		INSERT INTO application_users (id, email, status, created_at, updated_at)
		SELECT $1 || '-' || lpad(series::text, 4, '0'), $2 || '-' || lpad(series::text, 4, '0') || '@example.test', 'ACTIVE', $3, $3
		FROM generate_series(1, 501) AS series`, memberPrefix, memberEmailPrefix, now); err != nil {
		t.Fatalf("insert synthetic rotation member users: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO vault_members (vault_id, user_id, role, status, encrypted_vault_key, key_version, created_at, updated_at)
		SELECT $1, $2 || '-' || lpad(series::text, 4, '0'), 'VIEWER', 'ACTIVE', decode(repeat('00', 29), 'hex'), 1, $3, $3
		FROM generate_series(1, 501) AS series`, memberVaultID, memberPrefix, now); err != nil {
		t.Fatalf("insert synthetic oversized rotation member set: %v", err)
	}
	memberBlocker, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin oversized-member blocker transaction: %v", err)
	}
	defer func() { _ = memberBlocker.Rollback(ctx) }()
	blockedMemberID := fmt.Sprintf("%s-%04d", memberPrefix, 501)
	var lockedMemberID string
	if err := memberBlocker.QueryRow(ctx, `SELECT user_id FROM vault_members WHERE vault_id = $1 AND user_id = $2 FOR UPDATE`, memberVaultID, blockedMemberID).Scan(&lockedMemberID); err != nil {
		t.Fatalf("lock member beyond overflow cap: %v", err)
	}
	boundedContext, cancel = context.WithTimeout(ctx, 2*time.Second)
	rotated, err = repository.Rotate(boundedContext, ownerID, memberVaultID, rotation)
	cancel()
	if err != nil || rotated {
		t.Fatalf("oversized member rotation=%t err=%v; want bounded rejection without blocking on member 502", rotated, err)
	}
	if err := memberBlocker.Rollback(ctx); err != nil {
		t.Fatalf("release oversized-member blocker: %v", err)
	}
}

func insertRotationInvitation(t *testing.T, ctx context.Context, pool *pgxpool.Pool, vaultID string, expiresAt time.Time) {
	t.Helper()
	invitationID := mustRotationID(t)
	if _, err := pool.Exec(ctx, `
		INSERT INTO vault_invitations (id, vault_id, link_verifier, encrypted_package, status, expires_at, created_at)
		VALUES ($1, $2, $3, $4, 'PENDING', $5, $6)`, invitationID, vaultID, []byte(invitationID), []byte("synthetic-encrypted-invitation"), expiresAt, expiresAt.Add(-24*time.Hour)); err != nil {
		t.Fatalf("insert synthetic rotation invitation: %v", err)
	}
}

func mustRotationID(t *testing.T) string {
	t.Helper()
	id, err := testsupport.NewSyntheticCUID()
	if err != nil {
		t.Fatalf("generate synthetic rotation record ID: %v", err)
	}
	return id
}
