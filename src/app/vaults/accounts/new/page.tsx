import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthenticatorAccountCreator } from "@/modules/authenticator-account";
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
      <Button variant="ghost" asChild className="mb-5 -ml-2 text-muted-foreground hover:text-foreground">
        <Link href="/vaults"><ArrowLeft aria-hidden="true" />Kembali ke brankas</Link>
      </Button>
      <PageHeader eyebrow="Akun baru" title="Tambahkan akun autentikator" description="Pindai kode QR, unggah gambar, atau masukkan URI lalu tinjau tujuan penyimpanannya." />
      <SurfaceCard aria-label="Formulir akun autentikator baru"><AuthenticatorAccountCreator personalVaultId={personalVault.id} preferredVaultId={preferredVaultId} /></SurfaceCard>
    </AppPage>
  );
}
