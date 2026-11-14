package vaultmembership

import (
	"context"
	"time"

	membershiprepository "github.com/nooroctavian/rhasia-scret/apps/api/internal/repository/vault-membership"
)

type PostgreSQLQueryer = membershiprepository.PostgreSQLQueryer
type PostgreSQLExecutor = membershiprepository.PostgreSQLExecutor

func LockActiveSharedVaultsForViewer(ctx context.Context, transaction PostgreSQLQueryer, userID string) error {
	return membershiprepository.LockActiveSharedVaultsForViewer(ctx, transaction, userID)
}

func MarkActiveSharedViewerMembershipsLeft(ctx context.Context, executor PostgreSQLExecutor, userID string, now time.Time) error {
	return membershiprepository.MarkActiveSharedViewerMembershipsLeft(ctx, executor, userID, now)
}

func DeletePendingInvitationsForRecipient(ctx context.Context, executor PostgreSQLExecutor, userID string, email string) error {
	return membershiprepository.DeletePendingInvitationsForRecipient(ctx, executor, userID, email)
}
