-- CreateTable
CREATE TABLE "vault_audit_events" (
    "id" TEXT NOT NULL,
    "vault_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vault_audit_events_vault_id_created_at_idx" ON "vault_audit_events"("vault_id", "created_at");

-- AddForeignKey
ALTER TABLE "vault_audit_events" ADD CONSTRAINT "vault_audit_events_vault_id_fkey" FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
