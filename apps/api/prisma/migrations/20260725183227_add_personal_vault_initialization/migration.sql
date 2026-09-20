-- AlterTable
ALTER TABLE "vaults" ALTER COLUMN "encrypted_name" DROP NOT NULL;

-- CreateTable
CREATE TABLE "user_crypto_profiles" (
    "user_id" TEXT NOT NULL,
    "vault_unlock_salt" BYTEA NOT NULL,
    "wrapped_user_root_key" BYTEA NOT NULL,
    "root_key_wrapping_version" INTEGER NOT NULL,
    "encrypted_personal_vault_key" BYTEA NOT NULL,
    "personal_vault_key_encryption_version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_crypto_profiles_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "user_crypto_profiles" ADD CONSTRAINT "user_crypto_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "application_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
