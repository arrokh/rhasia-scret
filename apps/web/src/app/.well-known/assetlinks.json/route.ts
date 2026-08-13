import { NextResponse } from "next/server";
import { androidAssetLinks } from "@/modules/identity/infrastructure/mobile-app-link-association";

export const dynamic = "force-dynamic";

export function GET() {
  const association = androidAssetLinks();
  if (!association) return NextResponse.json({ error: "mobile_app_links_not_configured" }, { status: 503 });
  return NextResponse.json(association, { headers: { "Cache-Control": "public, max-age=3600" } });
}
