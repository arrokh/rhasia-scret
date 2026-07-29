-- AlterTable
ALTER TABLE "vault_invitations" ADD COLUMN     "expires_at" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days');

-- CreateIndex
CREATE INDEX "vault_invitations_status_expires_at_idx" ON "vault_invitations"("status", "expires_at");
