-- AlterTable
ALTER TABLE "application_users" ALTER COLUMN "supabase_user_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "vault_invitations" ALTER COLUMN "expires_at" SET DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days');

-- CreateTable
CREATE TABLE "external_identities" (
    "id" TEXT NOT NULL,
    "application_user_id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT,
    "email_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "external_identities_application_user_id_idx" ON "external_identities"("application_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_identities_issuer_subject_key" ON "external_identities"("issuer", "subject");

-- AddForeignKey
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_application_user_id_fkey" FOREIGN KEY ("application_user_id") REFERENCES "application_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
