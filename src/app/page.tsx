import { InvitedUserSignInForm } from "@/modules/identity/presentation/invited-user-sign-in-form";

export default function HomePage() {
  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="page-title">
        <div className="brand"><span className="brand-mark" aria-hidden="true">V</span><h1 id="page-title">Shared TOTP Vault</h1></div>
        <p>Sign in with the email address an administrator invited.</p>
        <InvitedUserSignInForm />
        <p className="auth-help">Need access? Ask a vault administrator to invite your email address.</p>
      </section>
    </main>
  );
}
