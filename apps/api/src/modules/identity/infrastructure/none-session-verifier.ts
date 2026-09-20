import type { SessionAssurance, SessionVerifier, VerifiedPrincipal } from "../application/session-verifier";

export class NoneSessionVerifier implements SessionVerifier {
  public async verify(_request: Request, _minimumAssurance?: SessionAssurance): Promise<VerifiedPrincipal | null> {
    return null;
  }
}
