package vaultmanagement

import (
	"context"

	vaultrepository "github.com/nooroctavian/rhasia-scret/apps/api/internal/repository/vault-management"
)

type PostgreSQLQueryer = vaultrepository.PostgreSQLQueryer
type ActiveSharedVault = vaultrepository.ActiveSharedVault

func LockActiveSharedVault(ctx context.Context, transaction PostgreSQLQueryer, vaultID string) (ActiveSharedVault, bool, error) {
	return vaultrepository.LockActiveSharedVault(ctx, transaction, vaultID)
}

func AssertActivePersonalVault(ctx context.Context, queryer PostgreSQLQueryer, ownerID string, vaultID string) error {
	return vaultrepository.AssertActivePersonalVault(ctx, queryer, ownerID, vaultID)
}

func LockActivePersonalVault(ctx context.Context, transaction PostgreSQLQueryer, ownerID string, vaultID string) (int64, bool, error) {
	return vaultrepository.LockActivePersonalVault(ctx, transaction, ownerID, vaultID)
}
