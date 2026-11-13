package infrastructure

import (
	"context"
	"testing"
	"time"

	identityinfrastructure "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity/infrastructure"
	membershipapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-membership/application"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestPostgresVaultParticipantRepositoryListsOwnerParticipantsWithKeysetCursors(t *testing.T) {
	pool := testsupport.NewDisposablePostgresPool(t)
	ctx := context.Background()
	now := time.Date(2026, time.July, 29, 12, 0, 0, 0, time.UTC)
	ownerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	firstViewerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	secondViewerID := testsupport.CreateSyntheticApplicationUser(t, pool)
	invitedUserID := testsupport.CreateSyntheticApplicationUser(t, pool)
	outsiderID := testsupport.CreateSyntheticApplicationUser(t, pool)
	vaultID := insertAccessVault(t, ctx, pool, ownerID, "ACTIVE", []byte("synthetic-encrypted-vault-name"), now, true)
	if _, err := pool.Exec(ctx, `UPDATE vaults SET members_can_delete_accounts = true WHERE id = $1`, vaultID); err != nil {
		t.Fatalf("set synthetic Vault default permissions: %v", err)
	}
	insertAccessMembership(t, ctx, pool, vaultID, ownerID, "OWNER", "ACTIVE", []byte("synthetic-owner-key-wrap"), 1, nil, nil, nil, now)
	orderedViewerIDs := []string{firstViewerID, secondViewerID}
	if orderedViewerIDs[0] > orderedViewerIDs[1] {
		orderedViewerIDs[0], orderedViewerIDs[1] = orderedViewerIDs[1], orderedViewerIDs[0]
	}
	tiedAt := time.Date(2026, time.July, 26, 12, 0, 0, 0, time.UTC)
	insertAccessMembership(t, ctx, pool, vaultID, orderedViewerIDs[0], "VIEWER", "ACTIVE", []byte("synthetic-viewer-key-wrap"), 1, ptrAccessBool(false), nil, nil, tiedAt)
	insertAccessMembership(t, ctx, pool, vaultID, orderedViewerIDs[1], "VIEWER", "ACTIVE", []byte("synthetic-second-viewer-key-wrap"), 1, nil, nil, nil, tiedAt)
	invitationID := mustAccessID(t)
	invitationCreatedAt := tiedAt.Add(time.Hour)
	expiresAt := now.Add(-time.Hour)
	if _, err := pool.Exec(ctx, `
		INSERT INTO vault_invitations
			(id, vault_id, recipient_user_id, link_verifier, encrypted_package, status, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, $7)`,
		invitationID, vaultID, invitedUserID, []byte("synthetic-link-verifier"), []byte("synthetic-encrypted-package"), invitationCreatedAt, expiresAt); err != nil {
		t.Fatalf("insert synthetic pending invitation: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM vault_invitations WHERE vault_id = $1`, vaultID)
		_, _ = pool.Exec(ctx, `DELETE FROM vault_audit_events WHERE vault_id = $1`, vaultID)
		_, _ = pool.Exec(ctx, `DELETE FROM authenticator_accounts WHERE vault_id = $1`, vaultID)
		_, _ = pool.Exec(ctx, `DELETE FROM vault_members WHERE vault_id = $1`, vaultID)
		_, _ = pool.Exec(ctx, `DELETE FROM vaults WHERE id = $1`, vaultID)
	})
	emailReader, err := identityinfrastructure.NewPostgresApplicationUserEmailReader(pool)
	if err != nil {
		t.Fatalf("create Application User email reader: %v", err)
	}
	repository, err := NewPostgresVaultParticipantRepository(pool, emailReader, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create participant repository: %v", err)
	}
	if page, err := repository.ListForOwner(ctx, outsiderID, vaultID, sharedapp.CursorPageRequest{Limit: 1}); err != nil || page != nil {
		t.Fatalf("non-owner participant page=%#v err=%v; want unavailable", page, err)
	}
	firstPage, err := repository.ListForOwner(ctx, ownerID, vaultID, sharedapp.CursorPageRequest{Limit: 1})
	if err != nil || firstPage == nil || firstPage.Owner.ID != ownerID || firstPage.Owner.Email != "integration-"+ownerID+"@example.test" ||
		firstPage.VaultDefaultAccountPermissionsRevision != 1 || !firstPage.VaultDefaultAccountPermissions.CanAddAccounts ||
		firstPage.VaultDefaultAccountPermissions.CanEditAccounts || !firstPage.VaultDefaultAccountPermissions.CanDeleteAccounts ||
		len(firstPage.Items) != 1 || firstPage.Items[0].Kind != membershipapp.VaultParticipantKindMember ||
		firstPage.Items[0].UserID == nil || *firstPage.Items[0].UserID != orderedViewerIDs[0] || firstPage.NextCursor == nil ||
		firstPage.NextCursor.Key != "member:"+orderedViewerIDs[0] {
		t.Fatalf("first owner participant page=%#v err=%v", firstPage, err)
	}
	if firstPage.Items[0].PermissionOverrides == nil || firstPage.Items[0].PermissionOverrides.CanAddAccounts == nil ||
		*firstPage.Items[0].PermissionOverrides.CanAddAccounts || firstPage.Items[0].EffectiveAccountPermissions == nil ||
		firstPage.Items[0].EffectiveAccountPermissions.Permissions.CanAddAccounts ||
		firstPage.Items[0].EffectiveAccountPermissions.Sources.CanAddAccounts != "MEMBER" {
		t.Fatalf("member permissions in participant page=%#v", firstPage.Items[0])
	}
	secondPage, err := repository.ListForOwner(ctx, ownerID, vaultID, sharedapp.CursorPageRequest{Limit: 1, Cursor: firstPage.NextCursor})
	if err != nil || secondPage == nil || len(secondPage.Items) != 1 || secondPage.Items[0].Kind != membershipapp.VaultParticipantKindMember ||
		secondPage.Items[0].UserID == nil || *secondPage.Items[0].UserID != orderedViewerIDs[1] || secondPage.NextCursor == nil ||
		secondPage.NextCursor.Key != "member:"+orderedViewerIDs[1] {
		t.Fatalf("second owner participant page=%#v err=%v", secondPage, err)
	}
	thirdPage, err := repository.ListForOwner(ctx, ownerID, vaultID, sharedapp.CursorPageRequest{Limit: 1, Cursor: secondPage.NextCursor})
	if err != nil || thirdPage == nil || len(thirdPage.Items) != 1 || thirdPage.Items[0].Kind != membershipapp.VaultParticipantKindInvitation ||
		thirdPage.Items[0].InvitationID == nil || *thirdPage.Items[0].InvitationID != invitationID ||
		thirdPage.Items[0].Email != "integration-"+invitedUserID+"@example.test" ||
		thirdPage.Items[0].InvitationState == nil || *thirdPage.Items[0].InvitationState != membershipapp.VaultParticipantInvitationExpired ||
		thirdPage.Items[0].ExpiresAt == nil || !thirdPage.Items[0].ExpiresAt.Equal(expiresAt) || thirdPage.NextCursor != nil {
		t.Fatalf("third owner participant page=%#v err=%v", thirdPage, err)
	}
	if cancelled, err := repository.CancelInvitation(ctx, outsiderID, vaultID, invitationID); err != nil || cancelled {
		t.Fatalf("non-owner invitation cancellation=%v err=%v; want unavailable", cancelled, err)
	}
	if cancelled, err := repository.CancelInvitation(ctx, ownerID, vaultID, invitationID); err != nil || !cancelled {
		t.Fatalf("owner invitation cancellation=%v err=%v; want cancelled", cancelled, err)
	}
	if cancelled, err := repository.CancelInvitation(ctx, ownerID, vaultID, invitationID); err != nil || cancelled {
		t.Fatalf("repeat invitation cancellation=%v err=%v; want unavailable", cancelled, err)
	}
}
