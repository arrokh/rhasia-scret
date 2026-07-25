import { NextResponse } from "next/server";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";
import { PrismaMembershipLifecycleRepository } from "@/modules/vault-membership/infrastructure/prisma-membership-lifecycle-repository";

export async function DELETE(_request: Request, { params }: { params: Promise<{ vaultId: string; userId: string }> }) {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  try {
    const { vaultId, userId } = await params;
    await new PrismaMembershipLifecycleRepository().revoke(user.id, vaultId, userId);
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "member_unavailable" }, { status: 404 });
  }
}
