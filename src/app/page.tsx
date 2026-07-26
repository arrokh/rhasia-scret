import { InvitedUserSignInForm } from "@/modules/identity/presentation/invited-user-sign-in-form";

export default function HomePage() {
  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="page-title">
        <div className="brand"><span className="brand-mark" aria-hidden="true">V</span><h1 id="page-title">Brankas TOTP Bersama</h1></div>
        <p>Masuk dengan alamat email yang diundang oleh administrator.</p>
        <InvitedUserSignInForm />
        <p className="auth-help">Butuh akses? Minta administrator brankas untuk mengundang alamat email Anda.</p>
      </section>
    </main>
  );
}
