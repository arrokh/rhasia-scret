import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { DestructivePersonalVaultResetForm } from "@/modules/vault-management";
import { AppPage, PageHeader, SurfaceCard } from "@/shared/presentation/app-ui";

export const dynamic = "force-dynamic";

/** Fixture khusus pengembangan untuk memeriksa reset destruktif tanpa data pengguna. */
export default async function RecoveryPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const t = await getTranslations("Preview.recovery");
  return (
    <AppPage>
      <PageHeader title={t("title")} description={t("description")} />
      <SurfaceCard className="p-5 sm:p-6" aria-label={t("label")}>
        <DestructivePersonalVaultResetForm />
      </SurfaceCard>
    </AppPage>
  );
}
