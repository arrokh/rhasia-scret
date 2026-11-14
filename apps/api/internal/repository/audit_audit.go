package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	apiEntity "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/postgres"
)

type VaultAuditTransaction = pgx.Tx

func AppendVaultAuditEvent(ctx context.Context, transaction VaultAuditTransaction, event apiEntity.VaultAuditAppend) error {
	if transaction == nil || event.VaultID == "" || event.OwnerID == "" || event.ActorUserID == "" || !apiEntity.IsValidAction(event.Action) {
		return errors.New("Vault audit event is invalid")
	}
	eventID, err := postgres.NewCUID()
	if err != nil {
		return err
	}
	var targetID any
	if event.TargetID != "" {
		targetID = event.TargetID
	}
	if _, err := transaction.Exec(ctx, `
		INSERT INTO vault_audit_events
			(id, vault_id, owner_id, actor_user_id, event_type, target_id, retention_purge_after)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		eventID, event.VaultID, event.OwnerID, event.ActorUserID, string(event.Action), targetID, event.RetentionPurgeAfter); err != nil {
		return fmt.Errorf("append Vault audit event: %w", err)
	}
	return nil
}
