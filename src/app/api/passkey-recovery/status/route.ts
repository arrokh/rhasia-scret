import { NextResponse } from "next/server";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { createApplicationUserRepository } from "@/modules/identity/server";
import { PrismaPasskeyRecoveryRepository } from "@/modules/identity/infrastructure/prisma-passkey-recovery-repository";
import { createSessionVerifier } from "@/modules/identity/server";

export async function GET() {
  const user = await loadApplicationUser(createSessionVerifier(), createApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });

  const credential = await new PrismaPasskeyRecoveryRepository().getCredential(user.id);
  return NextResponse.json({ enrolled: credential !== null });
}

