import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { AppPage, Brand, SurfaceCard } from "@/shared/presentation/app-ui";

export default async function LandingPage() {
  const t = await getTranslations("Home.landing");
  return (
    <AppPage centered>
      <SurfaceCard className="w-full max-w-xl px-5 py-8 sm:px-10 sm:py-12" aria-labelledby="page-title">
        <div className="flex flex-col items-center text-center">
          <h1 id="page-title"><Brand /></h1>
          <p className="mt-6 max-w-md text-base leading-7 text-muted-foreground sm:text-lg">{t("description")}</p>
          <div className="mt-8 grid gap-3 sm:flex sm:justify-center"><Button asChild className="w-full sm:w-auto sm:min-w-40"><Link href="/sign-in">{t("signIn")}</Link></Button><Button asChild variant="outline" className="w-full sm:w-auto"><Link href="/local">{t("localVault")}</Link></Button></div>
        </div>
      </SurfaceCard>
    </AppPage>
  );
}
