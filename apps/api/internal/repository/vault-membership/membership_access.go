package infrastructure

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	membershipdomain "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity/vault-membership"
)

type ActiveVaultMembership struct {
	Role       membershipdomain.SharedVaultMemberRole
	Overrides  membershipdomain.SharedVaultAccountPermissionOverrides
	KeyVersion *int64
}

type MembershipAccessQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func LockActiveVaultMembership(
	ctx context.Context,
	transaction MembershipAccessQueryer,
	vaultID string,
	userID string,
) (ActiveVaultMembership, bool, error) {
	var role string
	var canAdd, canEdit, canDelete pgtype.Bool
	var keyVersion pgtype.Int4
	err := transaction.QueryRow(ctx, `
		SELECT role, can_add_accounts_override, can_edit_accounts_override,
		       can_delete_accounts_override, key_version
		FROM vault_members
		WHERE vault_id = $1 AND user_id = $2 AND status = 'ACTIVE'
		FOR UPDATE`, vaultID, userID).Scan(&role, &canAdd, &canEdit, &canDelete, &keyVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return ActiveVaultMembership{}, false, nil
	}
	if err != nil {
		return ActiveVaultMembership{}, false, fmt.Errorf("lock active Shared Vault membership: %w", err)
	}
	parsedRole, validRole := membershipdomain.ParseSharedVaultMemberRole(role)
	if !validRole {
		return ActiveVaultMembership{}, false, nil
	}
	membership := ActiveVaultMembership{
		Role: parsedRole,
		Overrides: membershipdomain.SharedVaultAccountPermissionOverrides{
			CanAddAccounts:    nullableMembershipBool(canAdd),
			CanEditAccounts:   nullableMembershipBool(canEdit),
			CanDeleteAccounts: nullableMembershipBool(canDelete),
		},
	}
	if keyVersion.Valid {
		value := int64(keyVersion.Int32)
		membership.KeyVersion = &value
	}
	return membership, true, nil
}

func nullableMembershipBool(value pgtype.Bool) *bool {
	if !value.Valid {
		return nil
	}
	result := value.Bool
	return &result
}
