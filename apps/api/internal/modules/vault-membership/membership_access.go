package vaultmembership

import (
	"context"

	membershiprepository "github.com/nooroctavian/rhasia-scret/apps/api/internal/repository/vault-membership"
)

type ActiveVaultMembership = membershiprepository.ActiveVaultMembership
type MembershipAccessQueryer = membershiprepository.MembershipAccessQueryer

func LockActiveVaultMembership(ctx context.Context, transaction MembershipAccessQueryer, vaultID string, userID string) (ActiveVaultMembership, bool, error) {
	return membershiprepository.LockActiveVaultMembership(ctx, transaction, vaultID, userID)
}
