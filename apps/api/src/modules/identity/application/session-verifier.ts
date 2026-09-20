export type SessionAssurance = "verified-claims" | "fresh-provider-user" | "active-session";

export type VerifiedPrincipal = {
  issuer: string;
  subject: string;
  email: string;
  emailVerified: boolean;
  assurance: SessionAssurance;
  sessionId?: string;
  issuedAt?: Date;
};

export type VerifiedSession = VerifiedPrincipal;

export interface SessionVerifier {
  verify(request: Request, minimumAssurance?: SessionAssurance): Promise<VerifiedPrincipal | null>;
}

export function assuranceSatisfies(actual: SessionAssurance, minimum: SessionAssurance): boolean {
  const rank: Record<SessionAssurance, number> = {
    "verified-claims": 1,
    "fresh-provider-user": 2,
    "active-session": 3,
  };
  return rank[actual] >= rank[minimum];
}
