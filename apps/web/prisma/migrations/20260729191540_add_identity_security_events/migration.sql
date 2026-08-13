-- AlterTable
ALTER TABLE "vault_invitations" ALTER COLUMN "expires_at" SET DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days');

-- CreateTable
CREATE TABLE "identity_security_events" (
    "id" TEXT NOT NULL,
    "application_user_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_security_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "identity_security_events_application_user_id_created_at_id_idx" ON "identity_security_events"("application_user_id", "created_at", "id");

-- AddForeignKey
ALTER TABLE "identity_security_events" ADD CONSTRAINT "identity_security_events_application_user_id_fkey" FOREIGN KEY ("application_user_id") REFERENCES "application_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
