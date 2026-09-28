import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/shared/presentation/app-ui";

export async function ServerApiUnavailablePanel({ retryHref }: Readonly<{ retryHref: string }>) {
  const t = await getTranslations("Common.globalError");

  return (
    <div className="grid gap-4 p-5 sm:p-6">
      <StatusBanner tone="danger" role="alert" title={t("title")}>
        {t("description")}
      </StatusBanner>
      <div className="grid gap-3">
        <Button asChild>
          <Link href={retryHref}>{t("retry")}</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/local">{t("openLocalVault")}</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/offline">{t("openOffline")}</Link>
        </Button>
      </div>
    </div>
  );
}
