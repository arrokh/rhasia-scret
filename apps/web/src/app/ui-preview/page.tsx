import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthenticatorAccountDirectoryPreview } from "@/modules/authenticator-account";
import { PreviewAccountMenu } from "@/modules/identity/preview";
import { AppPage, PageHeader } from "@/shared/presentation/app-ui";

export const dynamic = "force-dynamic";

/** Fixture khusus pengembangan tanpa ciphertext untuk memeriksa tata letak seluler. */
export default async function MobilePreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const t = await getTranslations("Preview.mobile");
  return (
    <AppPage>
      <PageHeader title={t("title")} description={t("description")} action={<PreviewAccountMenu />} />
      <AuthenticatorAccountDirectoryPreview />
    </AppPage>
  );
}
