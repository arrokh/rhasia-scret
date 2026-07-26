import { redirect } from "next/navigation";
import { StatusBanner, AppPage, Brand, SurfaceCard } from "@/shared/presentation/app-ui";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";
import { InvitedUserSignInForm } from "@/modules/identity/presentation/invited-user-sign-in-form";

export const dynamic = "force-dynamic";

type HomePageProps = { searchParams: Promise<{ auth?: string | string[] }> };
type AuthNotice = { message: string; role: "alert" | "status"; tone: "danger" | "success" | "info" };

export default async function HomePage({ searchParams }: HomePageProps) {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (user?.canAccessApplication()) redirect("/vaults");

  const auth = (await searchParams).auth;
  const notice = authNotice(Array.isArray(auth) ? auth[0] : auth);

  return (
    <AppPage centered>
      <SurfaceCard className="w-full max-w-md px-5 py-7 sm:px-8 sm:py-9" aria-labelledby="page-title">
        <div className="flex flex-col items-center">
          <h1 id="page-title"><Brand /></h1>
          <p className="mt-5 text-center text-lg leading-7 font-bold text-ink-strong">Kode bersama keluarga Anda, aman dan mudah dijangkau.</p>
          <p className="mt-2 text-center text-sm leading-6 text-muted-foreground">Masuk dengan alamat email yang telah diundang. Kode dibuat secara privat di perangkat ini.</p>
        </div>
        <div className="mt-6 grid gap-5">
          {notice && <StatusBanner tone={notice.tone} role={notice.role}>{notice.message}</StatusBanner>}
          <InvitedUserSignInForm />
          <p className="text-center text-xs leading-5 text-muted-foreground">Akses hanya tersedia melalui undangan. Minta pemilik brankas atau administrator mengundang alamat email Anda.</p>
        </div>
      </SurfaceCard>
    </AppPage>
  );
}

function authNotice(auth: string | undefined): AuthNotice | null {
  if (auth === "required") return { message: "Silakan masuk untuk melanjutkan.", role: "status", tone: "info" };
  if (auth === "signed_out") return { message: "Anda telah keluar.", role: "status", tone: "success" };
  if (auth === "logout_failed") return { message: "Proses keluar tidak dapat diselesaikan. Coba lagi.", role: "alert", tone: "danger" };
  return null;
}
