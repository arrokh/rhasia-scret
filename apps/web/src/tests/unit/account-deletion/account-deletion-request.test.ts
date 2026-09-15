import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import {
  isBrowserAccountDeletionReadRequest,
  isBrowserAccountDeletionRequest,
} from "@/modules/account-deletion/infrastructure/account-deletion-request";

const originalOrigin = process.env.AUTH_APP_ORIGIN;

afterEach(() => {
  if (originalOrigin === undefined) delete process.env.AUTH_APP_ORIGIN;
  else process.env.AUTH_APP_ORIGIN = originalOrigin;
});

describe("account-deletion request boundaries", () => {
  it("accepts same-origin mutation requests only when Origin matches", () => {
    process.env.AUTH_APP_ORIGIN = "http://localhost:3000";
    expect(
      isBrowserAccountDeletionRequest(
        new NextRequest("http://localhost:3000/api/me", {
          method: "DELETE",
          headers: { origin: "http://localhost:3000" },
        }),
      ),
    ).toBe(true);
    expect(
      isBrowserAccountDeletionRequest(
        new NextRequest("http://localhost:3000/api/me", {
          method: "DELETE",
          headers: { origin: "https://attacker.example" },
        }),
      ),
    ).toBe(false);
  });

  it("protects the preview GET with Fetch Metadata when GET has no Origin", () => {
    process.env.AUTH_APP_ORIGIN = "http://localhost:3000";
    expect(
      isBrowserAccountDeletionReadRequest(
        new NextRequest("http://localhost:3000/api/me/deletion/preview", {
          headers: { "sec-fetch-site": "same-origin" },
        }),
      ),
    ).toBe(true);
    expect(
      isBrowserAccountDeletionReadRequest(
        new NextRequest("http://localhost:3000/api/me/deletion/preview", {
          headers: { "sec-fetch-site": "cross-site" },
        }),
      ),
    ).toBe(false);
    expect(
      isBrowserAccountDeletionReadRequest(
        new NextRequest("http://localhost:3000/api/me/deletion/preview", {
          headers: { authorization: "Bearer token", "sec-fetch-site": "same-origin" },
        }),
      ),
    ).toBe(false);
  });
});
