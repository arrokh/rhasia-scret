import { notFound } from "next/navigation";
import { DestructivePersonalVaultResetForm } from "@/modules/vault-management";
import { AppPage, PageHeader, SurfaceCard } from "@/shared/presentation/app-ui";

export const dynamic = "force-dynamic";

/** Fixture khusus pengembangan untuk memeriksa reset destruktif tanpa data pengguna. */
export default function RecoveryPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AppPage><PageHeader title="Reset destruktif" description="Fixture ini tidak memuat data, ciphertext, atau kunci pengguna." /><SurfaceCard className="p-5 sm:p-6" aria-label="Pratinjau reset destruktif"><DestructivePersonalVaultResetForm /></SurfaceCard></AppPage>;
}
