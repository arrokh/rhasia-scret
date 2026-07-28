import { redirect } from "next/navigation";
import { SharedVaultDetailWorkspace } from "@/modules/authenticator-account";
import { LogoutForm } from "@/modules/identity";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";
import { ensurePersonalVault } from "@/modules/vault-management/application/ensure-personal-vault";
import { PrismaPersonalVaultRepository } from "@/modules/vault-management/infrastructure/prisma-personal-vault-repository";
import { AppPage, PageHeader, SurfaceCard } from "@/shared/presentation/app-ui";

export const dynamic = "force-dynamic";

export default async function SharedVaultPage({ params }: { params: Promise<{ vaultId: string }> }) {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user || !user.canAccessApplication()) redirect("/sign-in");
  const personalVault = await ensurePersonalVault(user.id, new PrismaPersonalVaultRepository());
  if (personalVault.lifecycle === "UNINITIALIZED") redirect("/vaults");
  const { vaultId } = await params;
  return <AppPage><PageHeader backHref="/vaults/manage" backLabel="Kembali ke daftar brankas" title="Kelola Brankas Bersama" description="Kelola akun, undangan, dan riwayat audit sesuai izin Anda." action={<LogoutForm email={user.email} />} /><SurfaceCard aria-label="Detail Brankas Bersama"><SharedVaultDetailWorkspace personalVaultId={personalVault.id} vaultId={vaultId} /></SurfaceCard></AppPage>;
}
