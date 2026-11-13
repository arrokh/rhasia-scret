-- DropForeignKey
ALTER TABLE "vault_audit_events" DROP CONSTRAINT "vault_audit_events_vault_id_fkey";

-- DropIndex
DROP INDEX "vault_audit_events_vault_id_created_at_idx";

-- AlterTable
ALTER TABLE "vault_audit_events" ADD COLUMN     "owner_id" TEXT,
ADD COLUMN     "retention_purge_after" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "authenticator_accounts_purge_after_id_idx" ON "authenticator_accounts"("purge_after", "id");

-- CreateIndex
CREATE INDEX "vault_audit_events_vault_id_owner_id_created_at_idx" ON "vault_audit_events"("vault_id", "owner_id", "created_at");

-- CreateIndex
CREATE INDEX "vault_audit_events_retention_purge_after_id_idx" ON "vault_audit_events"("retention_purge_after", "id");

-- CreateIndex
CREATE INDEX "vaults_type_lifecycle_purge_after_id_idx" ON "vaults"("type", "lifecycle", "purge_after", "id");
