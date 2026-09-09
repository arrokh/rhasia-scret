import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import { createGetMeHandler } from "@/app/api/me/route";
import { ApplicationUser } from "@/modules/identity/domain/application-user";

describe("GET /api/me contract", () => {
  it("rejects an unauthenticated request without provisioning a user", async () => {
    const handler = createGetMeHandler({
      authenticate: async () => NextResponse.json({ error: "unauthenticated" }, { status: 401 }),
    });
    const response = await handler();
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthenticated" });
  });

  it("provisions and returns only the application user identity for an active session", async () => {
    const handler = createGetMeHandler({
      authenticate: async () =>
        new ApplicationUser("application-1", "supabase", "supabase-1", "person@example.test", "ACTIVE"),
    });
    const response = await handler();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "application-1", email: "person@example.test" });
  });

  it("denies inactive application users", async () => {
    const handler = createGetMeHandler({
      authenticate: async () => NextResponse.json({ error: "inactive_user" }, { status: 403 }),
    });
    const response = await handler();
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "inactive_user" });
  });
});
