import type { SessionAssurance, VerifiedPrincipal } from "./session-verifier";

export type IdentityLinkRequest = {
  applicationUserId: string;
  existing: VerifiedPrincipal;
  proposed: VerifiedPrincipal;
  existingReauthenticated: boolean;
  proposedReauthenticated: boolean;
};

export interface IdentityLinkRepository {
  link(request: IdentityLinkRequest): Promise<void>;
}

export async function linkIdentity(repository: IdentityLinkRepository, request: IdentityLinkRequest): Promise<void> {
  requireAssurance(request.existing, "existing");
  requireAssurance(request.proposed, "proposed");
  if (!request.existingReauthenticated || !request.proposedReauthenticated)
    throw new Error("Identity linking requires reauthentication.");
  if (request.existing.issuer === request.proposed.issuer && request.existing.subject === request.proposed.subject)
    throw new Error("Identity is already linked.");
  await repository.link(request);
}

function requireAssurance(principal: VerifiedPrincipal, label: string): void {
  const assurance: SessionAssurance = principal.assurance;
  if (assurance !== "active-session") throw new Error(`${label} identity requires active provider verification.`);
}
