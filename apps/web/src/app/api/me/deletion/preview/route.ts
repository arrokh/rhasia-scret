import { NextResponse, type NextRequest } from "next/server";
import { authenticateApplicationReader } from "@/shared/infrastructure/authenticated-application-request";
import {
  createAccountDeletionRepository,
  isBrowserAccountDeletionReadRequest,
  noStoreHeaders,
} from "@/modules/account-deletion/server";

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isBrowserAccountDeletionReadRequest(request))
    return NextResponse.json({ error: "browser_only" }, { status: 403, headers: noStoreHeaders() });
  const user = await authenticateApplicationReader("fresh-provider-user");
  if (user instanceof NextResponse) return user;
  try {
    const preview = await createAccountDeletionRepository().getPreview(user.id);
    return NextResponse.json(preview, { headers: noStoreHeaders() });
  } catch {
    return NextResponse.json({ error: "deletion_preview_unavailable" }, { status: 503, headers: noStoreHeaders() });
  }
}
