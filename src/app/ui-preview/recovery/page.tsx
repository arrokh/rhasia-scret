import { notFound } from "next/navigation";
import { DestructivePersonalVaultResetForm } from "@/modules/vault-management";

export const dynamic = "force-dynamic";

/** Fixture khusus pengembangan untuk memeriksa reset destruktif tanpa data pengguna. */
export default function RecoveryPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="vault-page">
      <header className="vault-header">
        <div>
          <p className="eyebrow">rhasia-scret · PRATINJAU UI</p>
          <h1>Reset destruktif</h1>
          <p className="vault-subtitle">Fixture ini tidak memuat data, ciphertext, atau kunci pengguna.</p>
        </div>
      </header>
      <section className="vault-card" aria-label="Pratinjau reset destruktif">
        <DestructivePersonalVaultResetForm />
      </section>
    </main>
  );
}
