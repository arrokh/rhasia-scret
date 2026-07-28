import { LockKeyhole } from "lucide-react";
import { redirect } from "next/navigation";
import { LogoutForm } from "@/modules/identity";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";
import { ensurePersonalVault } from "@/modules/vault-management/application/ensure-personal-vault";
import { PrismaPersonalVaultRepository } from "@/modules/vault-management/infrastructure/prisma-personal-vault-repository";
import { PersonalVaultSetupForm } from "@/modules/vault-management/presentation/personal-vault-setup-form";
import { PersonalVaultAccounts } from "@/modules/authenticator-account";
import { AppPage, PageHeader, SectionHeading, SurfaceCard } from "@/shared/presentation/app-ui";

export const dynamic = "force-dynamic";

export default async function VaultsPage() {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user || !user.canAccessApplication()) redirect("/sign-in");
  const personalVault = await ensurePersonalVault(user.id, new PrismaPersonalVaultRepository());
  const uninitialized = personalVault.lifecycle === "UNINITIALIZED";

  return (
    <AppPage>
      <PageHeader title="Akun autentikator" description={uninitialized ? "Siapkan brankas untuk mulai menyimpan kode dengan aman." : "Lihat dan salin kode dari semua brankas yang dapat Anda akses."} action={<LogoutForm email={user.email} />} />
      <SurfaceCard aria-label={uninitialized ? "Siapkan Brankas Pribadi" : "Daftar akun autentikator"}>
        {uninitialized ? (
          <div className="grid gap-6 p-5 sm:p-6">
            <SectionHeading icon={LockKeyhole} eyebrow="Pribadi" title="Siapkan Brankas Pribadi" description="Buat ruang terenkripsi yang hanya dapat Anda buka." />
            <PersonalVaultSetupForm />
          </div>
        ) : <PersonalVaultAccounts vaultId={personalVault.id} />}
      </SurfaceCard>
    </AppPage>
  );
}
