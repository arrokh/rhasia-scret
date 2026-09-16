-- CreateIndex
CREATE INDEX "vault_audit_events_vault_id_target_id_created_at_id_idx" ON "vault_audit_events"("vault_id", "target_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "vault_audit_events_vault_id_actor_user_id_created_at_id_idx" ON "vault_audit_events"("vault_id", "actor_user_id", "created_at", "id");
