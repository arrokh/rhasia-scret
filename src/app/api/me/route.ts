import { NextResponse } from "next/server";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";

export async function GET() {
  const session = await new SupabaseSessionVerifier().verify();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  return NextResponse.json({ subject: session.subject, email: session.email });
}
