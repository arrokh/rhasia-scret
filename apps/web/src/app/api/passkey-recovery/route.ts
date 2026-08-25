import { NextResponse } from "next/server";
import { createApplicationUserRepository, createPasskeyRecoveryRepository, createSessionVerifier, loadApplicationUser } from "@/modules/identity/server";
import { rateLimitApplicationUser } from "@/modules/rate-limiting";

export async function DELETE() {
  const user = await loadApplicationUser(createSessionVerifier(), createApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  const rateLimited = await rateLimitApplicationUser("recovery_mutation", user.id);
  if (rateLimited) return rateLimited;

  await createPasskeyRecoveryRepository().removeCredential(user.id);
  return new Response(null, { status: 204 });
}
