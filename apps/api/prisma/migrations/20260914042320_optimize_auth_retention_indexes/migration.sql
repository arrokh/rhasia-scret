-- AlterTable
ALTER TABLE "vault_invitations" ALTER COLUMN "expires_at" SET DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days');

-- CreateIndex
CREATE INDEX "auth_sessions_refresh_expires_at_idx" ON "auth_sessions"("refresh_expires_at");

-- CreateIndex
CREATE INDEX "auth_sessions_revoked_at_id_idx" ON "auth_sessions"("revoked_at", "id");

-- CreateIndex
CREATE INDEX "magic_link_challenges_expires_at_idx" ON "magic_link_challenges"("expires_at");
