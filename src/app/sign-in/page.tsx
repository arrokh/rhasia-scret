import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { StatusBanner, AppPage, Brand, SurfaceCard } from "@/shared/presentation/app-ui";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";
import { InvitedUserSignInForm } from "@/modules/identity/presentation/invited-user-sign-in-form";

export const dynamic = "force-dynamic";

type SignInPageProps = { searchParams: Promise<{ auth?: string | string[] }> };
type AuthNotice = { key: "required" | "signedOut" | "logoutFailed" | "missingCode" | "configurationError" | "verificationFailed"; role: "alert" | "status"; tone: "danger" | "success" | "info" };

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const t = await getTranslations("Home.signIn");
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (user?.canAccessApplication()) redirect("/vaults");

  const auth = (await searchParams).auth;
  const notice = authNotice(Array.isArray(auth) ? auth[0] : auth);

  return (
    <AppPage centered>
      <SurfaceCard className="w-full max-w-md px-5 py-7 sm:px-8 sm:py-9" aria-labelledby="page-title">
        <div className="flex flex-col items-center">
          <h1 id="page-title"><Brand /></h1>
          <p className="mt-5 text-center text-sm leading-6 text-muted-foreground">{t("tagline")}</p>
        </div>
        <div className="mt-6 grid gap-5">
          {notice && <StatusBanner tone={notice.tone} role={notice.role}>{t(`notice.${notice.key}`)}</StatusBanner>}
          <InvitedUserSignInForm />
          <Button variant="outline" asChild><Link href="/offline">{t("openOffline")}</Link></Button>
          <p className="text-center text-xs leading-5 text-muted-foreground">{t("inviteOnly")}</p>
        </div>
      </SurfaceCard>
    </AppPage>
  );
}

function authNotice(auth: string | undefined): AuthNotice | null {
  if (auth === "required") return { key: "required", role: "status", tone: "info" };
  if (auth === "signed_out") return { key: "signedOut", role: "status", tone: "success" };
  if (auth === "logout_failed") return { key: "logoutFailed", role: "alert", tone: "danger" };
  if (auth === "missing_code") return { key: "missingCode", role: "alert", tone: "danger" };
  if (auth === "configuration_error") return { key: "configurationError", role: "alert", tone: "danger" };
  if (auth === "verification_failed") return { key: "verificationFailed", role: "alert", tone: "danger" };
  return null;
}
