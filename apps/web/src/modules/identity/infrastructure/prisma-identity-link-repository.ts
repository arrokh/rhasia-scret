import type { IdentityLinkRepository, IdentityLinkRequest } from "../application/identity-linking";
import { prisma } from "@/shared/infrastructure/prisma-client";

export class PrismaIdentityLinkRepository implements IdentityLinkRepository {
  public async link(request: IdentityLinkRequest): Promise<void> {
    await prisma.$transaction(async (transaction) => {
      const existing = await transaction.externalIdentity.findUnique({
        where: { issuer_subject: { issuer: request.existing.issuer, subject: request.existing.subject } },
        select: { applicationUserId: true },
      });
      if (!existing || existing.applicationUserId !== request.applicationUserId)
        throw new Error("Existing identity is not owned by the Application User.");
      const proposed = await transaction.externalIdentity.findUnique({
        where: { issuer_subject: { issuer: request.proposed.issuer, subject: request.proposed.subject } },
        select: { applicationUserId: true },
      });
      if (proposed) throw new Error("The proposed identity is already linked.");
      await transaction.externalIdentity.create({
        data: {
          applicationUserId: request.applicationUserId,
          issuer: request.proposed.issuer,
          subject: request.proposed.subject,
          email: request.proposed.email,
          emailVerifiedAt: request.proposed.emailVerified ? new Date() : undefined,
        },
      });
      await transaction.identitySecurityEvent.create({
        data: { applicationUserId: request.applicationUserId, eventType: "IDENTITY_LINKED" },
      });
    });
  }
}
