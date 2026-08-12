-- DropIndex
DROP INDEX "vault_audit_events_vault_id_owner_id_created_at_idx";

-- CreateIndex
CREATE INDEX "vault_audit_events_vault_id_owner_id_created_at_id_idx" ON "vault_audit_events"("vault_id", "owner_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "vault_invitations_vault_id_status_created_at_id_idx" ON "vault_invitations"("vault_id", "status", "created_at", "id");

-- CreateIndex
CREATE INDEX "vault_members_vault_id_role_status_created_at_user_id_idx" ON "vault_members"("vault_id", "role", "status", "created_at", "user_id");
