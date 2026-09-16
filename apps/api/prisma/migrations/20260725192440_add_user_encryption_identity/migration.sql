-- AlterTable
ALTER TABLE "user_crypto_profiles" ADD COLUMN     "encrypted_user_private_key" BYTEA,
ADD COLUMN     "user_encryption_key_version" INTEGER,
ADD COLUMN     "user_encryption_public_key" JSONB;
