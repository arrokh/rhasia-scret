package infrastructure

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/service/account-deletion"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestPostgresAccountDeletionPreviewListsOnlyCurrentTransferCandidates(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	repository, err := NewPostgresPreviewRepository(pool)
	if err != nil {
		t.Fatalf("create deletion preview repository: %v", err)
	}
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	viewerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	inactiveViewerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	emptyKeyViewerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	otherOwnerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	if _, err := pool.Exec(ctx, `UPDATE application_users SET status = 'INACTIVE' WHERE id = $1`, inactiveViewerID); err != nil {
		t.Fatalf("deactivate synthetic candidate: %v", err)
	}
	createdAt := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	personalOldID := mustPreviewID(t)
	personalNewID := mustPreviewID(t)
	activeSharedID := mustPreviewID(t)
	deletedSharedID := mustPreviewID(t)
	memberOnlySharedID := mustPreviewID(t)
	missingKeyViewerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	vaultIDs := []string{personalOldID, personalNewID, activeSharedID, deletedSharedID, memberOnlySharedID}
	t.Cleanup(func() {
		for _, vaultID := range vaultIDs {
			_, _ = pool.Exec(ctx, `DELETE FROM vault_invitations WHERE vault_id = $1`, vaultID)
			_, _ = pool.Exec(ctx, `DELETE FROM vault_audit_events WHERE vault_id = $1`, vaultID)
			_, _ = pool.Exec(ctx, `DELETE FROM authenticator_accounts WHERE vault_id = $1`, vaultID)
			_, _ = pool.Exec(ctx, `DELETE FROM vault_members WHERE vault_id = $1`, vaultID)
			_, _ = pool.Exec(ctx, `DELETE FROM vaults WHERE id = $1`, vaultID)
		}
	})
	insertPreviewVault(t, ctx, pool, personalOldID, ownerID, "PERSONAL", "ACTIVE", createdAt)
	insertPreviewVault(t, ctx, pool, personalNewID, ownerID, "PERSONAL", "ACTIVE", createdAt.Add(time.Hour))
	insertPreviewVault(t, ctx, pool, activeSharedID, ownerID, "SHARED", "ACTIVE", createdAt)
	insertPreviewVault(t, ctx, pool, deletedSharedID, ownerID, "SHARED", "DELETED", createdAt.Add(time.Hour))
	insertPreviewVault(t, ctx, pool, memberOnlySharedID, otherOwnerID, "SHARED", "ACTIVE", createdAt)

	insertPreviewMember(t, ctx, pool, activeSharedID, ownerID, "OWNER", nil, nil, createdAt)
	insertPreviewMember(t, ctx, pool, activeSharedID, viewerID, "VIEWER", []byte("synthetic-encrypted-key"), ptrInt(1), createdAt)
	insertPreviewMember(t, ctx, pool, activeSharedID, inactiveViewerID, "VIEWER", []byte("synthetic-encrypted-key"), ptrInt(1), createdAt.Add(time.Second))
	insertPreviewMember(t, ctx, pool, activeSharedID, emptyKeyViewerID, "VIEWER", []byte{}, ptrInt(1), createdAt.Add(1500*time.Millisecond))
	insertPreviewMember(t, ctx, pool, activeSharedID, missingKeyViewerID, "VIEWER", nil, ptrInt(1), createdAt.Add(2*time.Second))
	insertPreviewMember(t, ctx, pool, deletedSharedID, viewerID, "VIEWER", []byte("synthetic-encrypted-key"), ptrInt(1), createdAt)
	insertPreviewMember(t, ctx, pool, memberOnlySharedID, ownerID, "VIEWER", []byte("synthetic-encrypted-key"), ptrInt(1), createdAt)

	preview, err := repository.GetPreview(ctx, ownerID)
	if err != nil {
		t.Fatalf("load account deletion preview: %v", err)
	}
	if preview.PersonalVaultID == nil || *preview.PersonalVaultID != personalOldID {
		t.Fatalf("personal vault in preview=%v; want oldest owned Personal Vault", preview.PersonalVaultID)
	}
	if len(preview.OwnedSharedVaults) != 2 || preview.OwnedSharedVaults[0].ID != activeSharedID ||
		preview.OwnedSharedVaults[1].ID != deletedSharedID {
		t.Fatalf("owned Shared Vault preview order/content=%#v", preview.OwnedSharedVaults)
	}
	active := preview.OwnedSharedVaults[0]
	if active.Lifecycle != "ACTIVE" || len(active.ViewerCandidates) != 1 || active.ViewerCandidates[0] != (application.DeletionViewerCandidate{ID: viewerID, Email: fmt.Sprintf("integration-%s@example.test", viewerID)}) {
		t.Fatalf("eligible transfer candidates=%#v; inactive, keyless, empty-key, and member-only users must be excluded", active)
	}
	deleted := preview.OwnedSharedVaults[1]
	if deleted.Lifecycle != "DELETED" || len(deleted.ViewerCandidates) != 0 {
		t.Fatalf("deleted vault candidates=%#v; deleted vault cannot be transferred", deleted)
	}
}

func insertPreviewVault(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string, ownerID string, vaultType string, lifecycle string, createdAt time.Time) {
	t.Helper()
	if _, err := pool.Exec(ctx, `
		INSERT INTO vaults (id, type, lifecycle, owner_id, encrypted_name, encryption_version, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, 1, $6, $6)`, id, vaultType, lifecycle, ownerID, []byte("synthetic-ciphertext"), createdAt); err != nil {
		t.Fatalf("insert synthetic vault %s: %v", id, err)
	}
}

func insertPreviewMember(t *testing.T, ctx context.Context, pool *pgxpool.Pool, vaultID string, userID string, role string, encryptedKey []byte, keyVersion *int, createdAt time.Time) {
	t.Helper()
	if _, err := pool.Exec(ctx, `
		INSERT INTO vault_members (vault_id, user_id, role, encrypted_vault_key, key_version, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $6)`, vaultID, userID, role, encryptedKey, keyVersion, createdAt); err != nil {
		t.Fatalf("insert synthetic vault member: %v", err)
	}
}

func ptrInt(value int) *int {
	return &value
}

func mustPreviewID(t *testing.T) string {
	t.Helper()
	id, err := testsupport.NewSyntheticCUID()
	if err != nil {
		t.Fatalf("generate synthetic Vault ID: %v", err)
	}
	return id
}
