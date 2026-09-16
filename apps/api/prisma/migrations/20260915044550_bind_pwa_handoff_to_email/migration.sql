-- AlterTable
ALTER TABLE "pwa_authentication_handoffs" ADD COLUMN     "normalized_email" TEXT;

-- AlterTable
ALTER TABLE "vault_invitations" ALTER COLUMN "expires_at" SET DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days');
