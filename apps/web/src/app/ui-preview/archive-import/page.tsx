import { notFound } from "next/navigation";
import { ArchiveImportPreviewClient } from "@/modules/vault-archive/preview";

export const dynamic = "force-dynamic";

export default function ArchiveImportPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ArchiveImportPreviewClient />;
}
