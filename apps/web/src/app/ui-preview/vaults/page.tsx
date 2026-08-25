import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LogoutForm } from "@/modules/identity";
import { AppPage, PageHeader } from "@/shared/presentation/app-ui";
import { VaultManagementPreview } from "@/modules/vault-management/preview";

export const dynamic = "force-dynamic";

export default async function VaultManagementPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const t = await getTranslations("Preview.vaults");
  return <AppPage><PageHeader backHref="/ui-preview" backLabel={t("back")} title={t("title")} description={t("description")} action={<LogoutForm email="preview@local.invalid" />} /><VaultManagementPreview /></AppPage>;
}
