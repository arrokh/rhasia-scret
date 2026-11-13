package infrastructure

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity"
	membershipapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-membership/application"
	membershipdomain "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/vault-membership/domain"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/postgres"
)

type PostgresSecureShareLinkRepository struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewPostgresSecureShareLinkRepository(pool *pgxpool.Pool, now func() time.Time) (*PostgresSecureShareLinkRepository, error) {
	if pool == nil {
		return nil, errors.New("Secure Share Link repository is not configured")
	}
	if now == nil {
		now = time.Now
	}
	return &PostgresSecureShareLinkRepository{pool: pool, now: now}, nil
}

func (repository *PostgresSecureShareLinkRepository) CreateForEmail(
	ctx context.Context,
	ownerID string,
	vaultID string,
	recipientEmail string,
	link membershipapp.NewSecureShareLink,
) (membershipapp.CreatedSecureShareLink, error) {
	normalizedEmail := normalizeInvitationEmail(recipientEmail)
	if ownerID == "" || vaultID == "" || normalizedEmail == "" || len(normalizedEmail) > membershipapp.MaxInvitationRecipientEmailLength ||
		link.ExpectedKeyVersion < 1 || len(link.LinkVerifier) != 32 || len(link.EncryptedPackage) < 13 {
		return membershipapp.CreatedSecureShareLink{}, membershipapp.ErrInvitationRecipientUnavailable
	}
	linkVerifier := append([]byte(nil), link.LinkVerifier...)
	defer clear(linkVerifier)
	encryptedPackage := append([]byte(nil), link.EncryptedPackage...)
	defer clear(encryptedPackage)
	now := repository.now()
	expiresAt := membershipdomain.InvitationExpiresAt(now)
	transaction, err := repository.pool.Begin(ctx)
	if err != nil {
		return membershipapp.CreatedSecureShareLink{}, fmt.Errorf("begin Secure Share Link invitation creation: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	if _, err := transaction.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, vaultID+":"+normalizedEmail); err != nil {
		return membershipapp.CreatedSecureShareLink{}, fmt.Errorf("serialize Secure Share Link invitation creation: %w", err)
	}
	var lockedVaultID string
	err = transaction.QueryRow(ctx, `
		SELECT id FROM vaults
		WHERE id = $1 AND owner_id = $2 AND type = 'SHARED' AND lifecycle = 'ACTIVE' AND deleted_at IS NULL
		FOR UPDATE`, vaultID, ownerID).Scan(&lockedVaultID)
	if errors.Is(err, pgx.ErrNoRows) {
		return membershipapp.CreatedSecureShareLink{}, membershipapp.ErrInvitationRecipientUnavailable
	}
	if err != nil {
		return membershipapp.CreatedSecureShareLink{}, fmt.Errorf("authorize Secure Share Link invitation creation: %w", err)
	}
	var ownerEmail string
	var ownerKeyVersion pgtype.Int4
	err = transaction.QueryRow(ctx, `
		SELECT owner.email, owner_member.key_version
		FROM vaults AS vault
		JOIN application_users AS owner ON owner.id = vault.owner_id
		JOIN vault_members AS owner_member ON owner_member.vault_id = vault.id
		WHERE vault.id = $1 AND vault.owner_id = $2 AND owner_member.user_id = $2
		  AND owner_member.role = 'OWNER' AND owner_member.status = 'ACTIVE'`, vaultID, ownerID).Scan(&ownerEmail, &ownerKeyVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return membershipapp.CreatedSecureShareLink{}, membershipapp.ErrInvitationConflict
	}
	if err != nil {
		return membershipapp.CreatedSecureShareLink{}, fmt.Errorf("read Secure Share Link owner key version: %w", err)
	}
	if !ownerKeyVersion.Valid || int64(ownerKeyVersion.Int32) != link.ExpectedKeyVersion {
		return membershipapp.CreatedSecureShareLink{}, membershipapp.ErrInvitationConflict
	}
	if normalizeInvitationEmail(ownerEmail) == normalizedEmail {
		return membershipapp.CreatedSecureShareLink{}, membershipapp.ErrInvitationRecipientUnavailable
	}
	var recipientUserID *string
	var activeRecipientID string
	err = transaction.QueryRow(ctx, `
		SELECT id FROM application_users
		WHERE lower(email) = $1 AND status = 'ACTIVE'
		LIMIT 1`, normalizedEmail).Scan(&activeRecipientID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return membershipapp.CreatedSecureShareLink{}, fmt.Errorf("find Secure Share Link recipient: %w", err)
	}
	if err == nil {
		recipientUserID = &activeRecipientID
		var membershipStatus string
		membershipErr := transaction.QueryRow(ctx, `
			SELECT status FROM vault_members WHERE vault_id = $1 AND user_id = $2`, vaultID, activeRecipientID).Scan(&membershipStatus)
		if membershipErr != nil && !errors.Is(membershipErr, pgx.ErrNoRows) {
			return membershipapp.CreatedSecureShareLink{}, fmt.Errorf("check Secure Share Link recipient membership: %w", membershipErr)
		}
		if membershipErr == nil && membershipStatus == "ACTIVE" {
			return membershipapp.CreatedSecureShareLink{}, membershipapp.ErrInvitationConflict
		}
	}
	var recipientBinding any
	if recipientUserID != nil {
		recipientBinding = *recipientUserID
	}
	pendingRows, err := transaction.Query(ctx, `
		SELECT id, expires_at
		FROM vault_invitations
		WHERE vault_id = $1 AND status = 'PENDING'
		  AND (recipient_email = $2 OR ($3::text IS NOT NULL AND recipient_user_id = $3))`, vaultID, normalizedEmail, recipientBinding)
	if err != nil {
		return membershipapp.CreatedSecureShareLink{}, fmt.Errorf("check pending Secure Share Link invitations: %w", err)
	}
	expiredIDs := make([]string, 0)
	for pendingRows.Next() {
		var invitationID string
		var invitationExpiresAt time.Time
		if err := pendingRows.Scan(&invitationID, &invitationExpiresAt); err != nil {
			pendingRows.Close()
			return membershipapp.CreatedSecureShareLink{}, fmt.Errorf("scan pending Secure Share Link invitation: %w", err)
		}
		if !membershipdomain.InvitationIsExpired(invitationExpiresAt, now) {
			pendingRows.Close()
			return membershipapp.CreatedSecureShareLink{}, membershipapp.ErrInvitationConflict
		}
		expiredIDs = append(expiredIDs, invitationID)
	}
	if err := pendingRows.Err(); err != nil {
		pendingRows.Close()
		return membershipapp.CreatedSecureShareLink{}, fmt.Errorf("iterate pending Secure Share Link invitations: %w", err)
	}
	pendingRows.Close()
	if len(expiredIDs) > 0 {
		if _, err := transaction.Exec(ctx, `DELETE FROM vault_invitations WHERE id = ANY($1::text[]) AND status = 'PENDING'`, expiredIDs); err != nil {
			return membershipapp.CreatedSecureShareLink{}, fmt.Errorf("replace expired Secure Share Link invitations: %w", err)
		}
	}
	invitationID, err := postgres.NewCUID()
	if err != nil {
		return membershipapp.CreatedSecureShareLink{}, err
	}
	var recipientID any
	if recipientUserID != nil {
		recipientID = *recipientUserID
	}
	var created membershipapp.CreatedSecureShareLink
	err = transaction.QueryRow(ctx, `
		INSERT INTO vault_invitations (id, vault_id, recipient_user_id, recipient_email, link_verifier, encrypted_package, status, expires_at, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, $8)
		RETURNING id, expires_at`, invitationID, vaultID, recipientID, normalizedEmail, linkVerifier, encryptedPackage, expiresAt, now).
		Scan(&created.ID, &created.ExpiresAt)
	if err != nil {
		return membershipapp.CreatedSecureShareLink{}, fmt.Errorf("create Secure Share Link invitation: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return membershipapp.CreatedSecureShareLink{}, fmt.Errorf("commit Secure Share Link invitation: %w", err)
	}
	return created, nil
}

func (repository *PostgresSecureShareLinkRepository) FindForRecipient(
	ctx context.Context,
	recipient membershipapp.SecureShareLinkRecipient,
	linkVerifier []byte,
) (*membershipapp.RedeemableSecureShareLink, error) {
	if recipient.UserID == "" || len(linkVerifier) != 32 {
		return nil, nil
	}
	verifier := append([]byte(nil), linkVerifier...)
	defer clear(verifier)
	now := repository.now()
	var result membershipapp.RedeemableSecureShareLink
	var ownerKeyVersion pgtype.Int4
	err := repository.pool.QueryRow(ctx, `
		SELECT invitation.id, invitation.vault_id, invitation.encrypted_package, owner_member.key_version
		FROM vault_invitations AS invitation
		JOIN vaults AS vault ON vault.id = invitation.vault_id
		JOIN vault_members AS owner_member ON owner_member.vault_id = vault.id
		WHERE invitation.link_verifier = $1 AND invitation.status = 'PENDING' AND invitation.expires_at > $2
		  AND (invitation.recipient_user_id = $3 OR (invitation.recipient_user_id IS NULL AND invitation.recipient_email = $4))
		  AND vault.type = 'SHARED' AND vault.lifecycle = 'ACTIVE' AND vault.deleted_at IS NULL
		  AND owner_member.role = 'OWNER' AND owner_member.status = 'ACTIVE'
		LIMIT 1`, verifier, now, recipient.UserID, normalizeInvitationEmail(recipient.Email)).
		Scan(&result.ID, &result.VaultID, &result.EncryptedPackage, &ownerKeyVersion)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (!ownerKeyVersion.Valid || ownerKeyVersion.Int32 < 1)) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find Secure Share Link for recipient: %w", err)
	}
	result.KeyVersion = int64(ownerKeyVersion.Int32)
	result.EncryptedPackage = append([]byte(nil), result.EncryptedPackage...)
	return &result, nil
}

func (repository *PostgresSecureShareLinkRepository) Redeem(
	ctx context.Context,
	recipient membershipapp.SecureShareLinkRecipient,
	invitationID string,
	encryptedVaultKey []byte,
	keyVersion int64,
	expectedPublicKey identity.PublicEncryptionKey,
) error {
	if recipient.UserID == "" || invitationID == "" || len(encryptedVaultKey) < 13 || keyVersion < 1 || identity.ValidatePublicEncryptionKey(expectedPublicKey) != nil {
		return membershipapp.ErrSecureShareLinkUnavailable
	}
	keyWrap := append([]byte(nil), encryptedVaultKey...)
	defer clear(keyWrap)
	transaction, err := repository.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin Secure Share Link redemption: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	if _, err := transaction.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, recipient.UserID); err != nil {
		return fmt.Errorf("serialize Secure Share Link recipient identity: %w", err)
	}
	matches, err := identity.MatchesUserEncryptionPublicKey(ctx, transaction, recipient.UserID, expectedPublicKey)
	if err != nil {
		return err
	}
	if !matches {
		return membershipapp.ErrStaleRecipientEncryptionIdentity
	}
	if _, err := transaction.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, invitationID); err != nil {
		return fmt.Errorf("serialize Secure Share Link redemption: %w", err)
	}
	now := repository.now()
	normalizedEmail := normalizeInvitationEmail(recipient.Email)
	var vaultID string
	err = transaction.QueryRow(ctx, `
		SELECT invitation.vault_id
		FROM vault_invitations AS invitation
		JOIN vaults AS vault ON vault.id = invitation.vault_id
		WHERE invitation.id = $1 AND invitation.status = 'PENDING' AND invitation.expires_at > $2
		  AND (invitation.recipient_user_id = $3 OR (invitation.recipient_user_id IS NULL AND invitation.recipient_email = $4))
		  AND vault.type = 'SHARED' AND vault.lifecycle = 'ACTIVE' AND vault.deleted_at IS NULL`,
		invitationID, now, recipient.UserID, normalizedEmail).Scan(&vaultID)
	if errors.Is(err, pgx.ErrNoRows) {
		return membershipapp.ErrSecureShareLinkUnavailable
	}
	if err != nil {
		return fmt.Errorf("load Secure Share Link invitation: %w", err)
	}
	var lockedVaultID string
	err = transaction.QueryRow(ctx, `
		SELECT id FROM vaults WHERE id = $1 AND type = 'SHARED' AND lifecycle = 'ACTIVE' AND deleted_at IS NULL FOR UPDATE`, vaultID).
		Scan(&lockedVaultID)
	if errors.Is(err, pgx.ErrNoRows) {
		return membershipapp.ErrSecureShareLinkUnavailable
	}
	if err != nil {
		return fmt.Errorf("lock Shared Vault for Secure Share Link redemption: %w", err)
	}
	var ownerKeyVersion pgtype.Int4
	err = transaction.QueryRow(ctx, `
		SELECT key_version FROM vault_members
		WHERE vault_id = $1 AND role = 'OWNER' AND status = 'ACTIVE'`, vaultID).Scan(&ownerKeyVersion)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (!ownerKeyVersion.Valid || int64(ownerKeyVersion.Int32) != keyVersion)) {
		return membershipapp.ErrSecureShareLinkUnavailable
	}
	if err != nil {
		return fmt.Errorf("read Shared Vault owner key version for Secure Share Link: %w", err)
	}
	var currentInvitationID string
	err = transaction.QueryRow(ctx, `
		SELECT id FROM vault_invitations
		WHERE id = $1 AND vault_id = $2 AND status = 'PENDING' AND expires_at > $3
		  AND (recipient_user_id = $4 OR (recipient_user_id IS NULL AND recipient_email = $5))
		FOR UPDATE`, invitationID, vaultID, repository.now(), recipient.UserID, normalizedEmail).Scan(&currentInvitationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return membershipapp.ErrSecureShareLinkUnavailable
	}
	if err != nil {
		return fmt.Errorf("recheck Secure Share Link invitation: %w", err)
	}
	var existingRole, existingStatus string
	err = transaction.QueryRow(ctx, `
		SELECT role, status FROM vault_members WHERE vault_id = $1 AND user_id = $2 FOR UPDATE`, vaultID, recipient.UserID).
		Scan(&existingRole, &existingStatus)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("read existing Secure Share Link membership: %w", err)
	}
	if err == nil {
		if existingRole != "VIEWER" || existingStatus == "ACTIVE" {
			return membershipapp.ErrSecureShareLinkUnavailable
		}
		if _, err := transaction.Exec(ctx, `
			UPDATE vault_members
			SET status = 'ACTIVE', encrypted_vault_key = $3, key_version = $4, revoked_at = NULL,
			    can_add_accounts_override = NULL, can_edit_accounts_override = NULL, can_delete_accounts_override = NULL,
			    permissions_revision = permissions_revision + 1, updated_at = $5
			WHERE vault_id = $1 AND user_id = $2`, vaultID, recipient.UserID, keyWrap, keyVersion, now); err != nil {
			return fmt.Errorf("reactivate Secure Share Link Viewer membership: %w", err)
		}
	} else {
		if _, err := transaction.Exec(ctx, `
			INSERT INTO vault_members (vault_id, user_id, role, status, encrypted_vault_key, key_version, created_at, updated_at)
			VALUES ($1, $2, 'VIEWER', 'ACTIVE', $3, $4, $5, $5)`, vaultID, recipient.UserID, keyWrap, keyVersion, now); err != nil {
			return fmt.Errorf("create Secure Share Link Viewer membership: %w", err)
		}
	}
	if _, err := transaction.Exec(ctx, `
		UPDATE vault_invitations SET recipient_user_id = $2, status = 'REDEEMED', redeemed_at = $3
		WHERE id = $1 AND status = 'PENDING'`, currentInvitationID, recipient.UserID, now); err != nil {
		return fmt.Errorf("consume Secure Share Link invitation: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit Secure Share Link redemption: %w", err)
	}
	return nil
}

func normalizeInvitationEmail(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

var _ membershipapp.SecureShareLinkRepository = (*PostgresSecureShareLinkRepository)(nil)
