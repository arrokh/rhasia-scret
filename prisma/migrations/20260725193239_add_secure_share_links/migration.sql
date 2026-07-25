-- CreateTable
CREATE TABLE "vault_invitations" (
    "id" TEXT NOT NULL,
    "vault_id" TEXT NOT NULL,
    "recipient_user_id" TEXT NOT NULL,
    "link_verifier" BYTEA NOT NULL,
    "encrypted_package" BYTEA NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "redeemed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vault_invitations_link_verifier_key" ON "vault_invitations"("link_verifier");

-- CreateIndex
CREATE INDEX "vault_invitations_vault_id_status_idx" ON "vault_invitations"("vault_id", "status");

-- CreateIndex
CREATE INDEX "vault_invitations_recipient_user_id_status_idx" ON "vault_invitations"("recipient_user_id", "status");

-- AddForeignKey
ALTER TABLE "vault_invitations" ADD CONSTRAINT "vault_invitations_vault_id_fkey" FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_invitations" ADD CONSTRAINT "vault_invitations_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "application_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
