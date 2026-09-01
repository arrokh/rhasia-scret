import { NextResponse } from "next/server";
import { createPasskeyRecoveryRepository } from "@/modules/identity/server";
import { authenticateApplicationReader } from "@/shared/infrastructure/authenticated-application-request";

export async function GET() {
  const user = await authenticateApplicationReader("fresh-provider-user");
  if (user instanceof NextResponse) return user;

  const credential = await createPasskeyRecoveryRepository().getCredential(user.id);
  return NextResponse.json({ enrolled: credential !== null });
}
