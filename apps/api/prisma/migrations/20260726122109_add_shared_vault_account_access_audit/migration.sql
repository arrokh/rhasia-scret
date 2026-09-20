-- AlterTable
ALTER TABLE "vault_audit_events" ADD COLUMN     "target_id" TEXT;

-- AddForeignKey
ALTER TABLE "vault_audit_events" ADD CONSTRAINT "vault_audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "application_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
