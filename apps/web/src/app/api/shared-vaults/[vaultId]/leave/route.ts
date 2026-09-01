import { NextResponse } from "next/server";
import { createMembershipLifecycleRepository, leaveVaultMembership, MembershipUnavailableError } from "@/modules/vault-membership/server";
import { authenticateApplicationMutation } from "@/shared/infrastructure/authenticated-application-request";

export async function POST(_request: Request, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await authenticateApplicationMutation("membership_mutation", "fresh-provider-user");
  if (user instanceof NextResponse) return user;
  try {
    const { vaultId } = await params;
    await leaveVaultMembership(user.id, vaultId, createMembershipLifecycleRepository());
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof MembershipUnavailableError) return NextResponse.json({ error: "viewer_membership_unavailable" }, { status: 404 });
    throw error;
  }
}
