import { redirect } from "next/navigation";
import { AuthenticatorAccountCreator } from "@/modules/authenticator-account";
import { LogoutForm } from "@/modules/identity";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";
import { ensurePersonalVault } from "@/modules/vault-management/application/ensure-personal-vault";
import { PrismaPersonalVaultRepository } from "@/modules/vault-management/infrastructure/prisma-personal-vault-repository";
import { AppPage, PageHeader, SurfaceCard } from "@/shared/presentation/app-ui";

export const dynamic = "force-dynamic";

export default async function NewAuthenticatorAccountPage({ searchParams }: { searchParams: Promise<{ vaultId?: string }> }) {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user || !user.canAccessApplication()) redirect("/");
  const personalVault = await ensurePersonalVault(user.id, new PrismaPersonalVaultRepository());
  const { vaultId: preferredVaultId } = await searchParams;
  if (personalVault.lifecycle === "UNINITIALIZED") redirect("/vaults");

  return (
    <AppPage>
      <PageHeader backHref="/vaults" backLabel="Kembali ke brankas" title="Tambahkan akun autentikator" description="Pindai kode QR atau unggah gambar lalu tinjau tujuan penyimpanannya." action={<LogoutForm email={user.email} />} />
      <SurfaceCard aria-label="Formulir akun autentikator baru"><AuthenticatorAccountCreator personalVaultId={personalVault.id} preferredVaultId={preferredVaultId} /></SurfaceCard>
    </AppPage>
  );
}
