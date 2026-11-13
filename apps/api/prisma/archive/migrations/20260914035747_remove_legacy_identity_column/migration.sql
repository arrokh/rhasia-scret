/*
  Warnings:

  - You are about to drop the legacy provider-subject column on the application_users table. All data in that column will be lost.

*/
-- Require the explicit passwordless identity seed before destructive cleanup.
DO $$
DECLARE
  application_user_count BIGINT;
  local_identity_count BIGINT;
  local_user_count BIGINT;
  invalid_mapping_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO application_user_count FROM "application_users";
  SELECT COUNT(*) INTO local_identity_count
    FROM "passwordless_identities" p
    JOIN "external_identities" e ON e.id = p.external_identity_id
    WHERE e.issuer = 'rhasia:passwordless';
  SELECT COUNT(DISTINCT e.application_user_id) INTO local_user_count
    FROM "passwordless_identities" p
    JOIN "external_identities" e ON e.id = p.external_identity_id
    WHERE e.issuer = 'rhasia:passwordless';
  SELECT COUNT(*) INTO invalid_mapping_count
    FROM "application_users" u
    WHERE NOT EXISTS (
      SELECT 1
      FROM "passwordless_identities" p
      JOIN "external_identities" e ON e.id = p.external_identity_id
      WHERE e.application_user_id = u.id
        AND e.issuer = 'rhasia:passwordless'
        AND p.normalized_email = LOWER(BTRIM(u.email))
        AND e.email = u.email
        AND e.email_verified_at IS NOT NULL
    );
  IF application_user_count <> local_identity_count OR application_user_count <> local_user_count OR invalid_mapping_count <> 0 THEN
    RAISE EXCEPTION 'passwordless identity seed is incomplete; run prisma:seed-passwordless-identities before legacy cleanup';
  END IF;
END $$;

-- DropIndex
DROP INDEX "application_users_supabase_user_id_key";

-- AlterTable
ALTER TABLE "application_users" DROP COLUMN "supabase_user_id";

-- AlterTable
ALTER TABLE "vault_invitations" ALTER COLUMN "expires_at" SET DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days');
