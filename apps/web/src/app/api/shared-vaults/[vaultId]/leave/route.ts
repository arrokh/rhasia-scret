import { NextResponse } from "next/server";
import { createApplicationUserRepository, createSessionVerifier, loadApplicationUser } from "@/modules/identity/server";
import { rateLimitApplicationUser } from "@/modules/rate-limiting";
import { createMembershipLifecycleRepository, leaveVaultMembership, MembershipUnavailableError } from "@/modules/vault-membership/server";

export async function POST(_request: Request, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await loadApplicationUser(createSessionVerifier(), createApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  const rateLimited = await rateLimitApplicationUser("membership_mutation", user.id);
  if (rateLimited) return rateLimited;
  try {
    const { vaultId } = await params;
    await leaveVaultMembership(user.id, vaultId, createMembershipLifecycleRepository());
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof MembershipUnavailableError) return NextResponse.json({ error: "viewer_membership_unavailable" }, { status: 404 });
    throw error;
  }
}
