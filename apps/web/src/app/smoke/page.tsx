import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppPage, PageHeader, SurfaceCard } from "@/shared/presentation/app-ui";

export const dynamic = "force-dynamic";

export default async function SmokePage() {
  if (process.env.NODE_ENV === "production") notFound();
  const t = await getTranslations("Smoke");
  return <AppPage><PageHeader title={t("title")} description={t("description")} /><SurfaceCard className="p-5 sm:p-6"><p data-testid="smoke-ready">{t("ready")}</p></SurfaceCard></AppPage>;
}
