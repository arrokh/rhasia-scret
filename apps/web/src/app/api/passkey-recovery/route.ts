import { NextResponse } from "next/server";
import { createPasskeyRecoveryRepository } from "@/modules/identity/server";
import { authenticateApplicationMutation } from "@/shared/infrastructure/authenticated-application-request";

export async function DELETE() {
  const user = await authenticateApplicationMutation("recovery_mutation", "fresh-provider-user");
  if (user instanceof NextResponse) return user;

  await createPasskeyRecoveryRepository().removeCredential(user.id);
  return new Response(null, { status: 204 });
}
