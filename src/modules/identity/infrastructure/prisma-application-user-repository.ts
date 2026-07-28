import { ApplicationUser, type ApplicationUserStatus } from "../domain/application-user";
import type { ApplicationUserRepository } from "../application/application-user-repository";
import type { VerifiedSession } from "../application/session-verifier";
import { prisma } from "@/shared/infrastructure/prisma-client";

type ApplicationUserRecord = {
  id: string;
  supabaseUserId: string;
  email: string;
  status: string;
};

export class PrismaApplicationUserRepository implements ApplicationUserRepository {
  public async provision(session: VerifiedSession): Promise<ApplicationUser> {
    const existing = await prisma.applicationUser.findUnique({ where: { supabaseUserId: session.subject } });
    if (existing?.email === session.email) return toApplicationUser(existing);
    if (existing) {
      return toApplicationUser(await prisma.applicationUser.update({
        where: { id: existing.id },
        data: { email: session.email }
      }));
    }
    const record = await prisma.applicationUser.upsert({
      where: { supabaseUserId: session.subject },
      create: { supabaseUserId: session.subject, email: session.email },
      update: { email: session.email }
    });
    return toApplicationUser(record);
  }
}

function toApplicationUser(record: ApplicationUserRecord): ApplicationUser {
  if (record.status !== "ACTIVE" && record.status !== "INACTIVE") {
    throw new Error("Application user has an invalid status.");
  }
  return new ApplicationUser(record.id, record.supabaseUserId, record.email, record.status as ApplicationUserStatus);
}
