import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/** Fixture khusus pengembangan tanpa ciphertext untuk memeriksa tata letak seluler. */
export default function MobilePreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="vault-page">
      <header className="vault-header">
        <div>
          <p className="eyebrow">rhasia-scret</p>
          <h1>Akun autentikator</h1>
          <p className="vault-subtitle">Pratinjau UI lokal. Tidak ada materi akun, passphrase, OTP, atau kunci yang digunakan dalam data contoh ini.</p>
        </div>
        <form action="/auth/logout" method="post"><button className="logout-button" type="submit">Keluar</button></form>
      </header>
      <section className="vault-card" aria-label="Daftar akun autentikator">
        <section className="vault-dashboard" aria-labelledby="preview-account-list-heading">
          <div className="dashboard-toolbar">
            <button className="secondary-button" type="button">Brankas Bersama</button>
            <details className="security-menu"><summary><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.6 2.9 8.4 7 10 4.1-1.6 7-5.4 7-10V6l-7-3Z" /></svg><span>Keamanan</span></summary></details>
            <Link className="add-account-link" href="/vaults/accounts/new" aria-label="Tambahkan akun autentikator">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg><span>Tambah akun</span>
            </Link>
          </div>
          <div className="vault-accounts-heading">
            <div><p className="eyebrow">SEMUA BRANKAS</p><h2 id="preview-account-list-heading">Akun autentikator</h2></div>
            <span className="account-count" aria-label="2 akun">2</span>
          </div>
          <ul className="account-list account-list-across-vaults">
            <li><span className="account-avatar" aria-hidden="true">L</span><span className="account-copy"><strong>Layanan contoh</strong><span>example@local.invalid</span></span><small className="vault-badge">Brankas Pribadi</small></li>
            <li><span className="account-avatar" aria-hidden="true">A</span><span className="account-copy"><strong>Akun kerja</strong><span>work@local.invalid</span></span><small className="vault-badge">Tim Operasional</small></li>
          </ul>
        </section>
      </section>
    </main>
  );
}
