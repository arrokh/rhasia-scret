import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/** Fixture khusus pengembangan tanpa ciphertext untuk memeriksa tata letak seluler. */
export default function MobilePreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <main className="vault-page"><header className="vault-header"><p className="eyebrow">PRATINJAU UI LOKAL</p><h1>Akun autentikator</h1><p className="vault-subtitle">Tidak ada materi akun, rahasia, OTP, atau kunci yang digunakan dalam data contoh ini.</p></header><section className="vault-card"><div className="vault-card-heading"><div><p className="eyebrow">PRIBADI</p><h2>Brankas Pribadi</h2></div><span className="vault-lock" aria-label="Brankas terenkripsi">🔒</span></div><section className="vault-accounts"><div className="vault-accounts-heading"><div><p className="eyebrow">AUTENTIKATOR</p><h2>Akun Brankas Pribadi</h2></div><span className="account-count" aria-label="2 akun">2</span></div><ul className="account-list"><li><strong>Layanan contoh</strong><span>example@local.invalid</span></li><li><strong>Akun kerja</strong><span>work@local.invalid</span></li></ul><form className="auth-form add-account-form"><label htmlFor="preview-uri">URI autentikator</label><input id="preview-uri" placeholder="otpauth://totp/..." readOnly /><button className="primary-button" type="button">Tambahkan akun terenkripsi</button></form></section></section></main>;
}
