import { Prisma } from "@prisma/client";
import { ApplicationUser, type ApplicationUserStatus } from "../domain/application-user";
import type { ApplicationUserRepository } from "../application/application-user-repository";
import type { VerifiedPrincipal } from "../application/session-verifier";
import { prisma } from "@/shared/infrastructure/prisma-client";

export type ApplicationAdmission = (principal: VerifiedPrincipal) => Promise<boolean>;

type ApplicationUserWithIdentity = {
  id: string;
  supabaseUserId: string | null;
  email: string;
  status: string;
  externalIdentities: Array<{ issuer: string; subject: string; email: string | null }>;
};

type ExistingExternalIdentity = {
  email: string | null;
  emailVerifiedAt: Date | null;
  applicationUser: ApplicationUserWithIdentity;
};

export class PrismaApplicationUserRepository implements ApplicationUserRepository {
  public constructor(private readonly isAdmitted: ApplicationAdmission = async () => true) {}

  public async provision(principal: VerifiedPrincipal): Promise<ApplicationUser> {
    const existingIdentity = await prisma.externalIdentity.findUnique({
      where: { issuer_subject: { issuer: principal.issuer, subject: principal.subject } },
      include: { applicationUser: { include: { externalIdentities: true } } },
    });
    if (existingIdentity) return this.resolveExistingIdentity(existingIdentity, principal);

    if (isSupabaseIssuer(principal.issuer)) {
      const legacy = await prisma.applicationUser.findUnique({
        where: { supabaseUserId: principal.subject },
        include: { externalIdentities: true },
      });
      if (legacy) {
        await prisma.externalIdentity.create({
          data: {
            applicationUserId: legacy.id,
            issuer: principal.issuer,
            subject: principal.subject,
            email: principal.email,
            emailVerifiedAt: principal.emailVerified ? new Date() : undefined,
          },
        });
        return this.updateExistingIdentity(legacy, principal);
      }
    }

    if (!principal.emailVerified || !(await this.isAdmitted(principal))) {
      throw new Error("Application admission denied.");
    }

    try {
      const created = await prisma.applicationUser.create({
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
      return toApplicationUser(created);
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;
      const racedIdentity = await prisma.externalIdentity.findUnique({
        where: { issuer_subject: { issuer: principal.issuer, subject: principal.subject } },
        include: { applicationUser: { include: { externalIdentities: true } } },
      });
      if (!racedIdentity) throw error;
      return this.resolveExistingIdentity(racedIdentity, principal);
    }
  }

  private async resolveExistingIdentity(
    identity: ExistingExternalIdentity,
    principal: VerifiedPrincipal,
  ): Promise<ApplicationUser> {
    if (identity.email === principal.email && (identity.emailVerifiedAt !== null || !principal.emailVerified)) {
      return toApplicationUser(identity.applicationUser);
    }
    return this.updateExistingIdentity(identity.applicationUser, principal);
  }

  private async updateExistingIdentity(
    record: ApplicationUserWithIdentity,
    principal: VerifiedPrincipal,
  ): Promise<ApplicationUser> {
    const updated = await prisma.$transaction(async (transaction) => {
      await transaction.externalIdentity
        .update({
          where: { issuer_subject: { issuer: principal.issuer, subject: principal.subject } },
          data: { email: principal.email, emailVerifiedAt: principal.emailVerified ? new Date() : undefined },
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
    return toApplicationUser(updated);
  }
}

function isUniqueConstraintViolation(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isSupabaseIssuer(issuer: string): boolean {
  return issuer === "supabase" || issuer === canonicalSupabaseIssuer();
}

function canonicalSupabaseIssuer(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return url ? `${url.replace(/\/$/, "")}/auth/v1` : "supabase";
}

function toApplicationUser(record: ApplicationUserWithIdentity): ApplicationUser {
  if (record.status !== "ACTIVE" && record.status !== "INACTIVE") {
    throw new Error("Application user has an invalid status.");
  }
  const identity = record.externalIdentities[0];
  if (!identity) {
    if (!record.supabaseUserId) throw new Error("Application user has no external identity.");
    return new ApplicationUser(
      record.id,
      canonicalSupabaseIssuer(),
      record.supabaseUserId,
      record.email,
      record.status as ApplicationUserStatus,
    );
  }
  return new ApplicationUser(
    record.id,
    identity.issuer,
    identity.subject,
    record.email,
    record.status as ApplicationUserStatus,
  );
}
