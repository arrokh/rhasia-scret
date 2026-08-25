import { NextResponse } from "next/server";
import { createApplicationUserRepository, createSessionVerifier, loadApplicationUser, type ApplicationUserRepository, type SessionVerifier } from "@/modules/identity/server";

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
  sessionVerifier: createSessionVerifier(),
  applicationUsers: createApplicationUserRepository()
});
