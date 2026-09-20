-- AlterTable
ALTER TABLE "vault_invitations" ALTER COLUMN "expires_at" SET DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days');

-- CreateTable
CREATE TABLE "pwa_authentication_handoffs" (
    "id" TEXT NOT NULL,
    "handoff_id_digest" BYTEA NOT NULL,
    "verifier_digest" BYTEA NOT NULL,
    "session_id" TEXT,
    "return_path" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "published_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pwa_authentication_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pwa_authentication_handoffs_handoff_id_digest_key" ON "pwa_authentication_handoffs"("handoff_id_digest");

-- CreateIndex
CREATE UNIQUE INDEX "pwa_authentication_handoffs_session_id_key" ON "pwa_authentication_handoffs"("session_id");

-- CreateIndex
CREATE INDEX "pwa_authentication_handoffs_expires_at_idx" ON "pwa_authentication_handoffs"("expires_at");

-- CreateIndex
CREATE INDEX "pwa_authentication_handoffs_consumed_at_expires_at_idx" ON "pwa_authentication_handoffs"("consumed_at", "expires_at");

-- AddForeignKey
ALTER TABLE "pwa_authentication_handoffs" ADD CONSTRAINT "pwa_authentication_handoffs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
