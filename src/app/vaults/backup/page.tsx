import { redirect } from "next/navigation";
import { LogoutForm } from "@/modules/identity";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";
import { VaultArchiveExportWorkspace } from "@/modules/vault-archive";
import { ensurePersonalVault } from "@/modules/vault-management/application/ensure-personal-vault";
import { PrismaPersonalVaultRepository } from "@/modules/vault-management/infrastructure/prisma-personal-vault-repository";
import { AppPage, PageHeader, SurfaceCard } from "@/shared/presentation/app-ui";

export const dynamic = "force-dynamic";

export default async function VaultArchiveBackupPage() {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user || !user.canAccessApplication()) redirect("/sign-in");
  const personalVault = await ensurePersonalVault(user.id, new PrismaPersonalVaultRepository());
  if (personalVault.lifecycle === "UNINITIALIZED") redirect("/vaults");
  return <AppPage><PageHeader backHref="/vaults/manage" backLabel="Kembali ke Brankas" title="Cadangan Brankas" description="Buat arsip terenkripsi dan simpan kuncinya secara terpisah." action={<LogoutForm email={user.email} />} /><SurfaceCard aria-label="Cadangan Brankas terenkripsi"><VaultArchiveExportWorkspace personalVaultId={personalVault.id} /></SurfaceCard></AppPage>;
}
