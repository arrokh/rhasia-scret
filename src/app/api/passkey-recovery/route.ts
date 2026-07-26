import { NextResponse } from "next/server";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { PrismaPasskeyRecoveryRepository } from "@/modules/identity/infrastructure/prisma-passkey-recovery-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";

export async function DELETE() {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });

  await new PrismaPasskeyRecoveryRepository().removeCredential(user.id);
  return new Response(null, { status: 204 });
}
