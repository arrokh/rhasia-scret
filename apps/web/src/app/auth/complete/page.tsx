import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { AppPage, Brand, SurfaceCard } from "@/shared/presentation/app-ui";
import { AuthCompletionAnnouncement } from "@/modules/identity/presentation/auth-completion-announcement";

export const dynamic = "force-dynamic";

export default async function AuthCompletionPage() {
  const t = await getTranslations("Identity.authCompletion");

  return (
    <AppPage centered>
      <SurfaceCard className="w-full max-w-md px-5 py-7 sm:px-8 sm:py-9">
        <AuthCompletionAnnouncement />
        <div className="flex flex-col items-center text-center">
          <h1>
            <Brand />
          </h1>
          <div className="mt-6 grid gap-2">
            <h2 className="text-lg font-bold text-ink-strong">{t("title")}</h2>
            <p className="text-sm leading-6 text-muted-foreground">{t("description")}</p>
          </div>
          <Button variant="outline" className="mt-6 w-full" asChild>
            <Link href="/vaults">{t("goToVaults")}</Link>
          </Button>
        </div>
      </SurfaceCard>
    </AppPage>
  );
}
