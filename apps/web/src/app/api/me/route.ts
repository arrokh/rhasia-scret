import { NextResponse } from "next/server";
import { authenticateApplicationReader } from "@/shared/infrastructure/authenticated-application-request";

type Dependencies = {
  authenticate: typeof authenticateApplicationReader;
};

export function createGetMeHandler({ authenticate }: Dependencies) {
  return async function GET() {
    const user = await authenticate("fresh-provider-user");
    if (user instanceof NextResponse) return user;
    return NextResponse.json({ id: user.id, email: user.email });
  };
}

export const GET = createGetMeHandler({
  authenticate: authenticateApplicationReader,
});
