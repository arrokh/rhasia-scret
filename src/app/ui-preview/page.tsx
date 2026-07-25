import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/** Development-only, ciphertext-free fixture for mobile layout inspection. */
export default function MobilePreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <main className="vault-page"><header className="vault-header"><p className="eyebrow">LOCAL UI PREVIEW</p><h1>Authenticator accounts</h1><p className="vault-subtitle">No account, secret, OTP, or key material is used in this fixture.</p></header><section className="vault-card"><div className="vault-card-heading"><div><p className="eyebrow">PERSONAL</p><h2>Personal Vault</h2></div><span className="vault-lock" aria-label="Encrypted vault">🔒</span></div><section className="vault-accounts"><div className="vault-accounts-heading"><div><p className="eyebrow">AUTHENTICATORS</p><h2>Personal Vault accounts</h2></div><span className="account-count" aria-label="2 accounts">2</span></div><ul className="account-list"><li><strong>Example service</strong><span>example@local.invalid</span></li><li><strong>Work account</strong><span>work@local.invalid</span></li></ul><form className="auth-form add-account-form"><label htmlFor="preview-uri">Authenticator URI</label><input id="preview-uri" placeholder="otpauth://totp/..." readOnly /><button className="primary-button" type="button">Add encrypted account</button></form></section></section></main>;
}
