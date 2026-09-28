import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthenticatorAccountDirectoryPreview } from "@/modules/authenticator-account";
import { PreviewAccountMenu } from "@/modules/identity/preview";
import { AppPage, PageHeader } from "@/shared/presentation/app-ui";

export const dynamic = "force-dynamic";

/** Ciphertext-free development fixture for the responsive authenticator-account layout. */
export default async function ResponsiveAuthenticatorAccountsPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const t = await getTranslations("Preview.authenticatorAccounts");
  return (
    <AppPage>
      <PageHeader title={t("title")} description={t("description")} action={<PreviewAccountMenu />} />
      <AuthenticatorAccountDirectoryPreview />
    </AppPage>
  );
}
