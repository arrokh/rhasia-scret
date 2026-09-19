import { describe, expect, it } from "vitest";
import { ApiRequest, ApiResponse } from "@api/http/api-request";
import { ApplicationUser } from "@api/modules/identity/domain/application-user";
import { createGetMeHandler } from "./route";

describe("GET /v1/me contract", () => {
  it("returns only the application identity for an authenticated user", async () => {
    const response = await createGetMeHandler({
      authenticate: async () =>
        new ApplicationUser("user_1", "rhasia:passwordless", "subject_1", "user@example.test", "ACTIVE"),
    })(new ApiRequest("https://api.example.test/v1/me"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "user_1", email: "user@example.test" });
  });

  it("preserves the authentication error without provisioning an identity", async () => {
    const response = await createGetMeHandler({
      authenticate: async () => ApiResponse.json({ error: "unauthenticated" }, { status: 401 }),
    })(new ApiRequest("https://api.example.test/v1/me"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthenticated" });
  });
});
