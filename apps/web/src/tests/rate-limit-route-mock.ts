import { vi } from "vitest";

vi.mock("@/modules/rate-limiting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/rate-limiting")>();
  return { ...actual, rateLimitApplicationUser: vi.fn(async () => null) };
});
