package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

type VaultParticipantRepository struct {
	pool   *pgxpool.Pool
	emails apiService.ApplicationUserEmailReader
	now    func() time.Time
}

func NewVaultParticipantRepository(
	pool *pgxpool.Pool,
	emails apiService.ApplicationUserEmailReader,
	now func() time.Time,
) (*VaultParticipantRepository, error) {
	if pool == nil || emails == nil {
		return nil, errors.New("Vault participant repository is not configured")
	}
	if now == nil {
		now = time.Now
	}
	return &VaultParticipantRepository{pool: pool, emails: emails, now: now}, nil
}

func (repository *VaultParticipantRepository) ListForOwner(
	ctx context.Context,
	ownerID string,
	vaultID string,
	request sharedapp.CursorPageRequest,
) (*apiService.VaultParticipantPage, error) {
	if ownerID == "" || vaultID == "" || request.Limit < 1 || request.Limit > 50 {
		return nil, nil
	}
	var vaultOwnerID string
	var defaults apiEntity.SharedVaultAccountPermissions
	var revision int32
	err := repository.pool.QueryRow(ctx, `
		SELECT owner_id, members_can_add_accounts, members_can_edit_accounts,
		       members_can_delete_accounts, member_permissions_revision
		FROM vaults
		WHERE id = $1 AND owner_id = $2 AND type = 'SHARED' AND lifecycle = 'ACTIVE' AND deleted_at IS NULL`,
		vaultID, ownerID).Scan(
		&vaultOwnerID, &defaults.CanAddAccounts, &defaults.CanEditAccounts,
		&defaults.CanDeleteAccounts, &revision,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load owner Shared Vault participant page: %w", err)
	}
	ownerEmails, err := repository.emails.ReadApplicationUserEmails(ctx, []string{vaultOwnerID})
	if err != nil {
		return nil, err
	}
	ownerEmail, found := ownerEmails[vaultOwnerID]
	if !found {
		return nil, errors.New("Shared Vault owner email is unavailable")
	}
	page := &apiService.VaultParticipantPage{
		Owner:                                  apiService.VaultParticipantOwner{ID: vaultOwnerID, Email: ownerEmail},
		VaultDefaultAccountPermissions:         defaults,
		VaultDefaultAccountPermissionsRevision: int64(revision),
		Items:                                  make([]apiService.VaultParticipant, 0),
	}

	var cursorKey *apiService.VaultParticipantCursorKey
	if request.Cursor != nil {
		parsed, valid := apiService.ParseVaultParticipantCursorKey(request.Cursor.Key)
		if !valid {
			return page, nil
		}
		cursorKey = &parsed
	}
	now := repository.now()
	if cursorKey == nil || cursorKey.Kind != string(apiService.VaultParticipantKindInvitation) {
		var cursorAt any
		var cursorUserID any
		if cursorKey != nil {
			cursorAt = request.Cursor.CreatedAt
			cursorUserID = cursorKey.ID
		}
		rows, err := repository.pool.Query(ctx, `
			SELECT member.user_id, member.created_at,
			       member.can_add_accounts_override, member.can_edit_accounts_override,
			       member.can_delete_accounts_override, member.permissions_revision
		FROM vault_members AS member
		JOIN vaults AS vault ON vault.id = member.vault_id
		WHERE member.vault_id = $1 AND member.role = 'VIEWER' AND member.status = 'ACTIVE'
		  AND vault.owner_id = $2 AND vault.type = 'SHARED' AND vault.lifecycle = 'ACTIVE' AND vault.deleted_at IS NULL
		  AND ($3::timestamp IS NULL OR member.created_at > $3 OR (member.created_at = $3 AND member.user_id > $4))
		ORDER BY member.created_at ASC, member.user_id ASC
		LIMIT $5`, vaultID, ownerID, cursorAt, cursorUserID, request.Limit+1)
		if err != nil {
			return nil, fmt.Errorf("list Shared Vault Viewer participants: %w", err)
		}
		members := make([]apiService.VaultParticipant, 0, request.Limit+1)
		memberIDs := make([]string, 0, request.Limit+1)
		type participantRecord struct {
			userID    string
			createdAt time.Time
			canAdd    pgtype.Bool
			canEdit   pgtype.Bool
			canDelete pgtype.Bool
			revision  int32
		}
		records := make([]participantRecord, 0, request.Limit+1)
		for rows.Next() {
			var record participantRecord
			if err := rows.Scan(&record.userID, &record.createdAt, &record.canAdd, &record.canEdit, &record.canDelete, &record.revision); err != nil {
				rows.Close()
				return nil, fmt.Errorf("scan Shared Vault Viewer participant: %w", err)
			}
			records = append(records, record)
			memberIDs = append(memberIDs, record.userID)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, fmt.Errorf("iterate Shared Vault Viewer participants: %w", err)
		}
		rows.Close()
		memberEmails, err := repository.emails.ReadApplicationUserEmails(ctx, memberIDs)
		if err != nil {
			return nil, err
		}
		for _, record := range records {
			email, ok := memberEmails[record.userID]
			if !ok {
				return nil, errors.New("Shared Vault member email is unavailable")
			}
			userID := record.userID
			permissionOverrides := apiEntity.SharedVaultAccountPermissionOverrides{
				CanAddAccounts: nullableBool(record.canAdd), CanEditAccounts: nullableBool(record.canEdit), CanDeleteAccounts: nullableBool(record.canDelete),
			}
			effective := apiEntity.EffectiveSharedVaultAccountPermissionsFor(apiEntity.SharedVaultMemberRoleViewer, defaults, permissionOverrides)
			memberRevision := int64(record.revision)
			members = append(members, apiService.VaultParticipant{
				Key: "member:" + record.userID, Email: email, Kind: apiService.VaultParticipantKindMember,
				UserID: &userID, InvitedAt: record.createdAt,
				PermissionOverrides: &permissionOverrides, EffectiveAccountPermissions: &effective,
				PermissionsRevision: &memberRevision,
			})
		}
		page.Items = append(page.Items, members...)
	}

	if len(page.Items) <= request.Limit {
		remaining := request.Limit + 1 - len(page.Items)
		var cursorAt any
		var cursorInvitationID any
		if cursorKey != nil && cursorKey.Kind == string(apiService.VaultParticipantKindInvitation) {
			cursorAt = request.Cursor.CreatedAt
			cursorInvitationID = cursorKey.ID
		}
		rows, err := repository.pool.Query(ctx, `
			SELECT invitation.id, invitation.recipient_email, invitation.recipient_user_id,
			       invitation.created_at, invitation.expires_at
		FROM vault_invitations AS invitation
		JOIN vaults AS vault ON vault.id = invitation.vault_id
		WHERE invitation.vault_id = $1 AND invitation.status = 'PENDING'
		  AND (invitation.recipient_email IS NOT NULL OR invitation.recipient_user_id IS NOT NULL)
		  AND vault.owner_id = $2 AND vault.type = 'SHARED' AND vault.lifecycle = 'ACTIVE' AND vault.deleted_at IS NULL
		  AND ($3::timestamp IS NULL OR invitation.created_at > $3 OR (invitation.created_at = $3 AND invitation.id > $4))
		ORDER BY invitation.created_at ASC, invitation.id ASC
		LIMIT $5`, vaultID, ownerID, cursorAt, cursorInvitationID, remaining)
		if err != nil {
			return nil, fmt.Errorf("list Shared Vault pending invitations: %w", err)
		}
		type invitationRecord struct {
			id              string
			recipientEmail  pgtype.Text
			recipientUserID pgtype.Text
			createdAt       time.Time
			expiresAt       time.Time
		}
		invitations := make([]invitationRecord, 0, remaining)
		recipientIDs := make([]string, 0, remaining)
		for rows.Next() {
			var invitation invitationRecord
			if err := rows.Scan(&invitation.id, &invitation.recipientEmail, &invitation.recipientUserID, &invitation.createdAt, &invitation.expiresAt); err != nil {
				rows.Close()
				return nil, fmt.Errorf("scan Shared Vault invitation participant: %w", err)
			}
			invitations = append(invitations, invitation)
			if !invitation.recipientEmail.Valid && invitation.recipientUserID.Valid {
				recipientIDs = append(recipientIDs, invitation.recipientUserID.String)
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, fmt.Errorf("iterate Shared Vault invitation participants: %w", err)
		}
		rows.Close()
		recipientEmails, err := repository.emails.ReadApplicationUserEmails(ctx, recipientIDs)
		if err != nil {
			return nil, err
		}
		for _, invitation := range invitations {
			email := ""
			if invitation.recipientEmail.Valid {
				email = invitation.recipientEmail.String
			} else if invitation.recipientUserID.Valid {
				email = recipientEmails[invitation.recipientUserID.String]
			}
			if email == "" {
				continue
			}
			invitationID := invitation.id
			var recipientUserID *string
			if invitation.recipientUserID.Valid {
				id := invitation.recipientUserID.String
				recipientUserID = &id
			}
			state := apiService.VaultParticipantInvitationPending
			if !invitation.expiresAt.After(now) {
				state = apiService.VaultParticipantInvitationExpired
			}
			invitationState := state
			expiresAt := invitation.expiresAt
			page.Items = append(page.Items, apiService.VaultParticipant{
				Key: "invitation:" + invitation.id, Email: email, Kind: apiService.VaultParticipantKindInvitation,
				UserID: recipientUserID, InvitationID: &invitationID, InvitationState: &invitationState,
				InvitedAt: invitation.createdAt, ExpiresAt: &expiresAt,
			})
		}
	}
	result := sharedapp.BuildCursorPage(page.Items, request.Limit, func(participant apiService.VaultParticipant) sharedapp.TimestampCursor {
		return sharedapp.TimestampCursor{CreatedAt: participant.InvitedAt, Key: participant.Key}
	})
	page.Items = result.Items
	page.NextCursor = result.NextCursor
	return page, nil
}

func (repository *VaultParticipantRepository) CancelInvitation(
	ctx context.Context,
	ownerID string,
	vaultID string,
	invitationID string,
) (bool, error) {
	if ownerID == "" || vaultID == "" || invitationID == "" {
		return false, nil
	}
	command, err := repository.pool.Exec(ctx, `
		DELETE FROM vault_invitations AS invitation
		WHERE invitation.id = $1 AND invitation.vault_id = $2 AND invitation.status = 'PENDING'
		  AND EXISTS (
			SELECT 1 FROM vaults AS vault
			WHERE vault.id = invitation.vault_id AND vault.owner_id = $3 AND vault.type = 'SHARED'
			  AND vault.lifecycle = 'ACTIVE' AND vault.deleted_at IS NULL
		  )`, invitationID, vaultID, ownerID)
	if err != nil {
		return false, fmt.Errorf("cancel pending Secure Share Link invitation: %w", err)
	}
	return command.RowsAffected() == 1, nil
}

var _ apiService.VaultParticipantRepository = (*VaultParticipantRepository)(nil)
