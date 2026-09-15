-- AlterTable
ALTER TABLE "vault_invitations" ALTER COLUMN "expires_at" SET DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days');

-- CreateTable
CREATE TABLE "account_deletion_records" (
    "id" TEXT NOT NULL,
    "application_user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "auth_backend" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL,
    "email_delivery_status" TEXT NOT NULL,
    "personal_vault_count" INTEGER NOT NULL,
    "shared_vault_deleted_count" INTEGER NOT NULL,
    "shared_vault_transferred_count" INTEGER NOT NULL,
    "authenticator_account_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_deletion_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_deletion_identities" (
    "id" TEXT NOT NULL,
    "deletion_record_id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_deletion_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_deletion_challenges" (
    "id" TEXT NOT NULL,
    "application_user_id" TEXT NOT NULL,
    "session_id" TEXT,
    "purpose" TEXT NOT NULL,
    "otp_digest" BYTEA,
    "authorization_digest" BYTEA,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "verified_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "completed_deletion_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_deletion_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_deletion_metrics" (
    "id" TEXT NOT NULL,
    "auth_backend" TEXT NOT NULL,
    "personal_vault_count" INTEGER NOT NULL,
    "shared_vault_deleted_count" INTEGER NOT NULL,
    "shared_vault_transferred_count" INTEGER NOT NULL,
    "authenticator_account_count" INTEGER NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_deletion_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_deletion_records_application_user_id_completed_at_idx" ON "account_deletion_records"("application_user_id", "completed_at");

-- CreateIndex
CREATE INDEX "account_deletion_records_email_completed_at_idx" ON "account_deletion_records"("email", "completed_at");

-- CreateIndex
CREATE INDEX "account_deletion_identities_issuer_subject_deleted_at_idx" ON "account_deletion_identities"("issuer", "subject", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "account_deletion_challenges_otp_digest_key" ON "account_deletion_challenges"("otp_digest");

-- CreateIndex
CREATE UNIQUE INDEX "account_deletion_challenges_authorization_digest_key" ON "account_deletion_challenges"("authorization_digest");

-- CreateIndex
CREATE INDEX "account_deletion_challenges_application_user_id_purpose_exp_idx" ON "account_deletion_challenges"("application_user_id", "purpose", "expires_at");

-- CreateIndex
CREATE INDEX "account_deletion_challenges_expires_at_idx" ON "account_deletion_challenges"("expires_at");

-- CreateIndex
CREATE INDEX "account_deletion_challenges_completed_deletion_id_idx" ON "account_deletion_challenges"("completed_deletion_id");

-- CreateIndex
CREATE INDEX "account_deletion_metrics_occurred_at_auth_backend_idx" ON "account_deletion_metrics"("occurred_at", "auth_backend");

-- AddForeignKey
ALTER TABLE "account_deletion_identities" ADD CONSTRAINT "account_deletion_identities_deletion_record_id_fkey" FOREIGN KEY ("deletion_record_id") REFERENCES "account_deletion_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
