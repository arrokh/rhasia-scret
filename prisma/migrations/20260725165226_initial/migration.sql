-- CreateTable
CREATE TABLE "application_users" (
    "id" TEXT NOT NULL,
    "supabase_user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaults" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "lifecycle" TEXT NOT NULL DEFAULT 'ACTIVE',
    "owner_id" TEXT NOT NULL,
    "encrypted_name" BYTEA NOT NULL,
    "encryption_version" INTEGER NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "purge_after" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_members" (
    "vault_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "encrypted_vault_key" BYTEA,
    "key_version" INTEGER,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vault_members_pkey" PRIMARY KEY ("vault_id","user_id")
);

-- CreateTable
CREATE TABLE "authenticator_accounts" (
    "id" TEXT NOT NULL,
    "vault_id" TEXT NOT NULL,
    "encrypted_payload" BYTEA NOT NULL,
    "encryption_version" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMP(3),
    "purge_after" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "authenticator_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "application_users_supabase_user_id_key" ON "application_users"("supabase_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "application_users_email_key" ON "application_users"("email");

-- CreateIndex
CREATE INDEX "vaults_owner_id_type_lifecycle_idx" ON "vaults"("owner_id", "type", "lifecycle");

-- CreateIndex
CREATE INDEX "vault_members_user_id_status_idx" ON "vault_members"("user_id", "status");

-- CreateIndex
CREATE INDEX "authenticator_accounts_vault_id_deleted_at_idx" ON "authenticator_accounts"("vault_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "vaults" ADD CONSTRAINT "vaults_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "application_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_members" ADD CONSTRAINT "vault_members_vault_id_fkey" FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_members" ADD CONSTRAINT "vault_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "application_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authenticator_accounts" ADD CONSTRAINT "authenticator_accounts_vault_id_fkey" FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
