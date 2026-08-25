import { notFound } from "next/navigation";
import { ArchiveBackupPreviewClient } from "@/modules/vault-archive/preview";

export const dynamic = "force-dynamic";

export default function ArchiveBackupPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ArchiveBackupPreviewClient />;
}
