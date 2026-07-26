import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthenticatorAccountCreator } from "@/modules/authenticator-account";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";
import { ensurePersonalVault } from "@/modules/vault-management/application/ensure-personal-vault";
import { PrismaPersonalVaultRepository } from "@/modules/vault-management/infrastructure/prisma-personal-vault-repository";

export const dynamic = "force-dynamic";

export default async function NewAuthenticatorAccountPage({ searchParams }: { searchParams: Promise<{ vaultId?: string }> }) {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user || !user.canAccessApplication()) redirect("/");
  const personalVault = await ensurePersonalVault(user.id, new PrismaPersonalVaultRepository());
  const { vaultId: preferredVaultId } = await searchParams;
  if (personalVault.lifecycle === "UNINITIALIZED") redirect("/vaults");

  return (
    <main className="vault-page account-creator-page">
      <Link className="account-back-link" href="/vaults">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
        Kembali ke brankas
      </Link>
      <header className="vault-header account-creator-header">
        <div>
          <p className="eyebrow">AKUN BARU</p>
          <h1>Tambahkan akun autentikator</h1>
          <p className="vault-subtitle">Impor kode QR atau masukkan URI, lalu pilih brankas tujuan.</p>
        </div>
      </header>
      <section className="vault-card account-creator-card" aria-label="Formulir akun autentikator baru">
        <AuthenticatorAccountCreator personalVaultId={personalVault.id} preferredVaultId={preferredVaultId} />
      </section>
    </main>
  );
}
