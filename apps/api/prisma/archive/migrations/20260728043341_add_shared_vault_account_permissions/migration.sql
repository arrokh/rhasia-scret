-- AlterTable
ALTER TABLE "vault_members" ADD COLUMN     "can_add_accounts_override" BOOLEAN,
ADD COLUMN     "can_delete_accounts_override" BOOLEAN,
ADD COLUMN     "can_edit_accounts_override" BOOLEAN,
ADD COLUMN     "permissions_revision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "vaults" ADD COLUMN     "member_permissions_revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "members_can_add_accounts" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "members_can_delete_accounts" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "members_can_edit_accounts" BOOLEAN NOT NULL DEFAULT false;
