-- DropForeignKey
ALTER TABLE "vault_invitations" DROP CONSTRAINT "vault_invitations_recipient_user_id_fkey";

-- AlterTable
ALTER TABLE "vault_invitations" ADD COLUMN     "recipient_email" TEXT,
ALTER COLUMN "recipient_user_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "vault_invitations_recipient_email_status_idx" ON "vault_invitations"("recipient_email", "status");

-- AddForeignKey
ALTER TABLE "vault_invitations" ADD CONSTRAINT "vault_invitations_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "application_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
