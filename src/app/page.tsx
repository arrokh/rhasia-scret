import { redirect } from "next/navigation";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";
import { InvitedUserSignInForm } from "@/modules/identity/presentation/invited-user-sign-in-form";

export const dynamic = "force-dynamic";

type HomePageProps = { searchParams: Promise<{ auth?: string | string[] }> };

type AuthNotice = { message: string; role: "alert" | "status" };

export default async function HomePage({ searchParams }: HomePageProps) {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (user?.canAccessApplication()) redirect("/vaults");

  const auth = (await searchParams).auth;
  const notice = authNotice(Array.isArray(auth) ? auth[0] : auth);

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="page-title">
        <div className="brand"><span className="brand-mark" aria-hidden="true">R</span><h1 id="page-title">rhasia-scret</h1></div>
        <p>Autentikator TOTP terenkripsi untuk brankas pribadi dan bersama. Masuk dengan alamat email yang diundang oleh administrator.</p>
        {notice && <p className="auth-notice" role={notice.role}>{notice.message}</p>}
        <InvitedUserSignInForm />
        <p className="auth-help">Butuh akses? Minta administrator brankas untuk mengundang alamat email Anda.</p>
      </section>
    </main>
  );
}

function authNotice(auth: string | undefined): AuthNotice | null {
  if (auth === "required") return { message: "Silakan masuk untuk melanjutkan.", role: "status" };
  if (auth === "signed_out") return { message: "Anda telah keluar.", role: "status" };
  if (auth === "logout_failed") return { message: "Proses keluar tidak dapat diselesaikan. Coba lagi.", role: "alert" };
  return null;
}
