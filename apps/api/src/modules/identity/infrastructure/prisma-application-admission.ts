import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";
import type { VerifiedPrincipal } from "../application/session-verifier";

export async function isOidcPrincipalAdmitted(
  principal: VerifiedPrincipal,
  database: PrismaDatabase,
  configuredEmails: ReadonlySet<string> = new Set(),
): Promise<boolean> {
  if (configuredEmails.has(principal.email.toLowerCase())) return true;
  const invitation = await database.vaultInvitation.findFirst({
    where: { recipientEmail: principal.email.toLowerCase(), status: "PENDING", expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  return invitation !== null;
}
