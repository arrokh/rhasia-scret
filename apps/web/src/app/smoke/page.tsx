import { getTranslations } from "next-intl/server";
import { AppPage, PageHeader, SurfaceCard } from "@/shared/presentation/app-ui";

export default async function SmokePage() {
  const t = await getTranslations("Smoke");
  return <AppPage><PageHeader title={t("title")} description={t("description")} /><SurfaceCard className="p-5 sm:p-6"><p data-testid="smoke-ready">{t("ready")}</p></SurfaceCard></AppPage>;
}
