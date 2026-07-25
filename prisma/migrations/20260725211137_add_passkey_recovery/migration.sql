-- CreateTable
CREATE TABLE "passkey_recovery_credentials" (
    "user_id" TEXT NOT NULL,
    "credential_id" BYTEA NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" JSONB,
    "encrypted_recovery_package" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "passkey_recovery_credentials_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "passkey_recovery_challenges" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "passkey_recovery_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "passkey_recovery_credentials_credential_id_key" ON "passkey_recovery_credentials"("credential_id");

-- CreateIndex
CREATE INDEX "passkey_recovery_challenges_user_id_purpose_expires_at_idx" ON "passkey_recovery_challenges"("user_id", "purpose", "expires_at");

-- AddForeignKey
ALTER TABLE "passkey_recovery_credentials" ADD CONSTRAINT "passkey_recovery_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "application_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passkey_recovery_challenges" ADD CONSTRAINT "passkey_recovery_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "application_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
