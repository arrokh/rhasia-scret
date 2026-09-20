import { Prisma } from "@prisma/client";
import { ApplicationUser, type ApplicationUserStatus } from "../domain/application-user";
import {
  ApplicationUserCredentialInvalidatedError,
  type ApplicationUserRepository,
} from "../application/application-user-repository";
import type { VerifiedPrincipal } from "../application/session-verifier";
import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";

export type ApplicationAdmission = (principal: VerifiedPrincipal) => Promise<boolean>;

type ApplicationUserWithIdentity = {
  id: string;
  email: string;
  status: string;
  externalIdentities: Array<{ issuer: string; subject: string; email: string | null }>;
};

type ExistingExternalIdentity = {
  issuer: string;
  subject: string;
  email: string | null;
  emailVerifiedAt: Date | null;
  applicationUser: ApplicationUserWithIdentity;
};

export class PrismaApplicationUserRepository implements ApplicationUserRepository {
  public constructor(
    private readonly database: PrismaDatabase,
    private readonly isAdmitted: ApplicationAdmission = async () => true,
  ) {}

  public async provision(principal: VerifiedPrincipal): Promise<ApplicationUser> {
    await this.assertCredentialWasIssuedAfterDeletion(principal);
    const existingIdentity = await this.database.externalIdentity.findUnique({
      where: { issuer_subject: { issuer: principal.issuer, subject: principal.subject } },
      include: { applicationUser: { include: { externalIdentities: true } } },
    });
    if (existingIdentity) return this.resolveExistingIdentity(existingIdentity, principal);

    if (!principal.emailVerified || !(await this.isAdmitted(principal))) {
      throw new Error("Application admission denied.");
    }

    try {
      const created = await this.database.applicationUser.create({
        data: {
          email: principal.email,
          externalIdentities: {
            create: {
              issuer: principal.issuer,
              subject: principal.subject,
              email: principal.email,
              emailVerifiedAt: new Date(),
            },
          },
        },
        include: { externalIdentities: true },
      });
      return toApplicationUser(created, principal);
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;
      const racedIdentity = await this.database.externalIdentity.findUnique({
        where: { issuer_subject: { issuer: principal.issuer, subject: principal.subject } },
        include: { applicationUser: { include: { externalIdentities: true } } },
      });
      if (!racedIdentity) throw error;
      return this.resolveExistingIdentity(racedIdentity, principal);
    }
  }

  private async assertCredentialWasIssuedAfterDeletion(principal: VerifiedPrincipal): Promise<void> {
    const deletion = await this.database.accountDeletionIdentity.findFirst({
      where: { issuer: principal.issuer, subject: principal.subject },
      orderBy: { deletedAt: "desc" },
      select: { deletedAt: true },
    });
    if (deletion && (!principal.issuedAt || principal.issuedAt.getTime() <= deletion.deletedAt.getTime()))
      throw new ApplicationUserCredentialInvalidatedError();
  }

  private async resolveExistingIdentity(
    identity: ExistingExternalIdentity,
    principal: VerifiedPrincipal,
  ): Promise<ApplicationUser> {
    if (identity.email === principal.email && (identity.emailVerifiedAt !== null || !principal.emailVerified)) {
      return toApplicationUser(identity.applicationUser, identity);
    }
    return this.updateExistingIdentity(identity.applicationUser, principal);
  }

  private async updateExistingIdentity(
    record: ApplicationUserWithIdentity,
    principal: VerifiedPrincipal,
  ): Promise<ApplicationUser> {
    const updated = await this.database.$transaction(async (transaction) => {
      await transaction.externalIdentity
        .update({
          where: { issuer_subject: { issuer: principal.issuer, subject: principal.subject } },
          data: { email: principal.email, emailVerifiedAt: principal.emailVerified ? new Date() : null },
        })
        .catch(async () => {
          await transaction.externalIdentity.create({
            data: {
              applicationUserId: record.id,
              issuer: principal.issuer,
              subject: principal.subject,
              email: principal.email,
              emailVerifiedAt: principal.emailVerified ? new Date() : undefined,
            },
          });
        });
      return transaction.applicationUser.update({
        where: { id: record.id },
        data: { email: principal.email },
        include: { externalIdentities: true },
      });
    });
    return toApplicationUser(updated, principal);
  }
}

function isUniqueConstraintViolation(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function toApplicationUser(
  record: ApplicationUserWithIdentity,
  selectedIdentity?: Readonly<{ issuer: string; subject: string }>,
): ApplicationUser {
  if (record.status !== "ACTIVE" && record.status !== "INACTIVE") {
    throw new Error("Application user has an invalid status.");
  }
  const identity = selectedIdentity
    ? record.externalIdentities.find(
        (candidate) => candidate.issuer === selectedIdentity.issuer && candidate.subject === selectedIdentity.subject,
      )
    : record.externalIdentities[0];
  if (!identity) throw new Error("Application user has no matching external identity.");
  return new ApplicationUser(
    record.id,
    identity.issuer,
    identity.subject,
    record.email,
    record.status as ApplicationUserStatus,
  );
}
