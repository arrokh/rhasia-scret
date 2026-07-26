import { notFound } from "next/navigation";
import { LogoutForm } from "@/modules/identity";
import { AppPage, PageHeader } from "@/shared/presentation/app-ui";
import { VaultManagementPreview } from "./vault-management-preview";

export const dynamic = "force-dynamic";

export default function VaultManagementPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AppPage><PageHeader backHref="/ui-preview" backLabel="Kembali ke pratinjau akun" title="Brankas" description="Pratinjau navigasi dan pengelolaan brankas khusus pengembangan." action={<LogoutForm email="preview@local.invalid" />} /><VaultManagementPreview /></AppPage>;
}
