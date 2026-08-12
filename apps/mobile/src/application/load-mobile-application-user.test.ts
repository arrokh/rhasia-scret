import type { AuthenticatedTransport, PlatformHttpResponse } from "../../../../src/shared/application/platform-ports";
import { loadMobileApplicationUser } from "./load-mobile-application-user";

function transport(status: number, body: unknown): AuthenticatedTransport {
  const response: PlatformHttpResponse = {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async <Value>() => body as Value,
    bytes: async () => new Uint8Array(),
    text: async () => JSON.stringify(body),
  };
  return { request: jest.fn(async () => response) };
}

describe("loadMobileApplicationUser", () => {
  it("loads only a typed admitted application user through authenticated transport", async () => {
    await expect(loadMobileApplicationUser(transport(200, { id: "opaque-user", email: "owner@example.test" }))).resolves.toEqual({
      status: "active",
      user: { id: "opaque-user", email: "owner@example.test" },
    });
  });

  it.each([[401, "unauthenticated"], [403, "inactive"], [500, "unavailable"]] as const)("maps HTTP %s without leaking response details", async (status, expected) => {
    await expect(loadMobileApplicationUser(transport(status, { error: "server-code" }))).resolves.toEqual({ status: expected });
  });

  it("rejects malformed success bodies", async () => {
    await expect(loadMobileApplicationUser(transport(200, { id: "opaque-user" }))).resolves.toEqual({ status: "unavailable" });
  });
});
