import { NextResponse } from "next/server";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import type { ApplicationUserRepository } from "@/modules/identity/application/application-user-repository";
import type { SessionVerifier } from "@/modules/identity/application/session-verifier";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";

type Dependencies = {
  sessionVerifier: SessionVerifier;
  applicationUsers: ApplicationUserRepository;
};

export function createGetMeHandler({ sessionVerifier, applicationUsers }: Dependencies) {
  return async function GET() {
    const user = await loadApplicationUser(sessionVerifier, applicationUsers);
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
    return NextResponse.json({ id: user.id, email: user.email });
  };
}

export const GET = createGetMeHandler({
  sessionVerifier: new SupabaseSessionVerifier(),
  applicationUsers: new PrismaApplicationUserRepository()
});
