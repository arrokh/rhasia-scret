import { prisma } from "@/shared/infrastructure/prisma-client";
import type { VerifiedPrincipal } from "../application/session-verifier";

export async function isOidcPrincipalAdmitted(principal: VerifiedPrincipal): Promise<boolean> {
  const configuredEmails = new Set((process.env.AUTH_ADMITTED_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
  if (configuredEmails.has(principal.email.toLowerCase())) return true;
  const invitation = await prisma.vaultInvitation.findFirst({
    where: { recipientEmail: principal.email.toLowerCase(), status: "PENDING", expiresAt: { gt: new Date() } },
    select: { id: true }
  });
  return invitation !== null;
}
