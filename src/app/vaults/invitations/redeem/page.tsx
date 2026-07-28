import { redirect } from "next/navigation";
import { InvitationRedemptionWorkspace } from "@/modules/authenticator-account";
import { LogoutForm } from "@/modules/identity";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";
import { ensurePersonalVault } from "@/modules/vault-management/application/ensure-personal-vault";
import { PrismaPersonalVaultRepository } from "@/modules/vault-management/infrastructure/prisma-personal-vault-repository";
import { AppPage, PageHeader, SurfaceCard } from "@/shared/presentation/app-ui";

export const dynamic = "force-dynamic";

export default async function RedeemInvitationPage() {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user || !user.canAccessApplication()) redirect("/sign-in");
  const personalVault = await ensurePersonalVault(user.id, new PrismaPersonalVaultRepository());
  if (personalVault.lifecycle === "UNINITIALIZED") redirect("/vaults");
  return <AppPage><PageHeader backHref="/vaults/manage" backLabel="Kembali ke daftar brankas" title="Undangan Brankas Bersama" description="Verifikasi dan terima tautan aman yang dikirim pemilik brankas." action={<LogoutForm email={user.email} />} /><SurfaceCard aria-label="Terima undangan Brankas Bersama"><InvitationRedemptionWorkspace personalVaultId={personalVault.id} /></SurfaceCard></AppPage>;
}
