import type { SessionAssurance, SessionVerifier, VerifiedPrincipal } from "../application/session-verifier";
import { assuranceSatisfies } from "../application/session-verifier";

type TestPrincipal = Omit<VerifiedPrincipal, "issuer" | "emailVerified" | "assurance"> &
  Partial<Pick<VerifiedPrincipal, "issuer" | "emailVerified" | "assurance">>;

export class FakeSessionVerifier implements SessionVerifier {
  private readonly normalizedSession: VerifiedPrincipal | null;

  public constructor(session: TestPrincipal | null) {
    this.normalizedSession = session
      ? {
          issuer: session.issuer ?? "supabase",
          subject: session.subject,
          email: session.email,
          emailVerified: session.emailVerified ?? true,
          assurance: session.assurance ?? "fresh-provider-user",
          sessionId: session.sessionId,
        }
      : null;
  }

  public async verify(minimumAssurance: SessionAssurance = "verified-claims"): Promise<VerifiedPrincipal | null> {
    if (
      !this.normalizedSession ||
      !this.normalizedSession.emailVerified ||
      !assuranceSatisfies(this.normalizedSession.assurance, minimumAssurance)
    )
      return null;
    return this.normalizedSession;
  }
}
