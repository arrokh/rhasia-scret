import type { SessionVerifier, VerifiedSession } from "../application/session-verifier";

export class FakeSessionVerifier implements SessionVerifier {
  public constructor(private readonly session: VerifiedSession | null) {}
  public async verify(): Promise<VerifiedSession | null> { return this.session; }
}
