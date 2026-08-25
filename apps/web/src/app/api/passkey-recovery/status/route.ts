import { NextResponse } from "next/server";
import { createApplicationUserRepository, createPasskeyRecoveryRepository, createSessionVerifier, loadApplicationUser } from "@/modules/identity/server";

export async function GET() {
  const user = await loadApplicationUser(createSessionVerifier(), createApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });

  const credential = await createPasskeyRecoveryRepository().getCredential(user.id);
  return NextResponse.json({ enrolled: credential !== null });
}

