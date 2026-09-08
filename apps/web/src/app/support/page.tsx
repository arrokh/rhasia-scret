import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PublicInformationPage } from "@/modules/public-information/presentation/public-information-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Support");
  return { title: t("metadataTitle") };
}

export default function SupportRoute() {
  return <PublicInformationPage kind="support" />;
}
