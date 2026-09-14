-- AlterTable
ALTER TABLE "identity_security_events" ADD COLUMN     "session_id" TEXT;

-- AlterTable
ALTER TABLE "vault_invitations" ALTER COLUMN "expires_at" SET DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days');

-- CreateTable
CREATE TABLE "passwordless_identities" (
    "id" TEXT NOT NULL,
    "external_identity_id" TEXT NOT NULL,
    "normalized_email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "passwordless_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "magic_link_challenges" (
    "id" TEXT NOT NULL,
    "normalized_email" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'sign_in',
    "token_digest" BYTEA NOT NULL,
    "client" TEXT NOT NULL,
    "return_path" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "magic_link_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "application_user_id" TEXT NOT NULL,
    "access_token_digest" BYTEA NOT NULL,
    "refresh_token_digest" BYTEA NOT NULL,
    "refresh_family" TEXT NOT NULL,
    "access_expires_at" TIMESTAMP(3) NOT NULL,
    "refresh_expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revocation_reason" TEXT,
    "refresh_rotated_at" TIMESTAMP(3),
    "reuse_detected_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anonymous_auth_rate_limit_windows" (
    "bucket_hash" BYTEA NOT NULL,
    "operation" TEXT NOT NULL,
    "window_started_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "request_count" INTEGER NOT NULL,

    CONSTRAINT "anonymous_auth_rate_limit_windows_pkey" PRIMARY KEY ("bucket_hash","operation","window_started_at")
);

-- CreateIndex
CREATE UNIQUE INDEX "passwordless_identities_external_identity_id_key" ON "passwordless_identities"("external_identity_id");

-- CreateIndex
CREATE UNIQUE INDEX "passwordless_identities_normalized_email_key" ON "passwordless_identities"("normalized_email");

-- CreateIndex
CREATE UNIQUE INDEX "magic_link_challenges_token_digest_key" ON "magic_link_challenges"("token_digest");

-- CreateIndex
CREATE INDEX "magic_link_challenges_normalized_email_purpose_created_at_idx" ON "magic_link_challenges"("normalized_email", "purpose", "created_at");

-- CreateIndex
CREATE INDEX "magic_link_challenges_purpose_expires_at_idx" ON "magic_link_challenges"("purpose", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_access_token_digest_key" ON "auth_sessions"("access_token_digest");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_refresh_token_digest_key" ON "auth_sessions"("refresh_token_digest");

-- CreateIndex
CREATE INDEX "auth_sessions_application_user_id_revoked_at_idx" ON "auth_sessions"("application_user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "auth_sessions_access_expires_at_idx" ON "auth_sessions"("access_expires_at");

-- CreateIndex
CREATE INDEX "auth_sessions_refresh_family_revoked_at_refresh_expires_at_idx" ON "auth_sessions"("refresh_family", "revoked_at", "refresh_expires_at");

-- CreateIndex
CREATE INDEX "anonymous_auth_rate_limit_windows_expires_at_idx" ON "anonymous_auth_rate_limit_windows"("expires_at");

-- AddForeignKey
ALTER TABLE "passwordless_identities" ADD CONSTRAINT "passwordless_identities_external_identity_id_fkey" FOREIGN KEY ("external_identity_id") REFERENCES "external_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_application_user_id_fkey" FOREIGN KEY ("application_user_id") REFERENCES "application_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
