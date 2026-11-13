-- AlterTable
ALTER TABLE "account_deletion_identities" ADD COLUMN     "normalized_email" TEXT;

-- CreateIndex
CREATE INDEX "account_deletion_identities_normalized_email_deleted_at_idx" ON "account_deletion_identities"("normalized_email", "deleted_at");
