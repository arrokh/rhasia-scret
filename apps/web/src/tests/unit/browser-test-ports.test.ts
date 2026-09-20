import { describe, expect, it } from "vitest";
import { parseBrowserTestPort, resolveBrowserTestPort } from "../../../scripts/browser-test-ports";

describe("browser test port allocation", () => {
  it("honors an explicitly configured browser port", async () => {
    await expect(resolveBrowserTestPort({ BROWSER_TEST_PORT: "3210" })).resolves.toBe(3210);
  });

  it("rejects invalid browser ports", () => {
    expect(() => parseBrowserTestPort("3100.5")).toThrow("numeric TCP port");
    expect(() => parseBrowserTestPort("80")).toThrow("between 1024 and 65534");
  });

  it("allocates a valid browser port block when no port is configured", async () => {
    const port = await resolveBrowserTestPort({});

    expect(port).toBeGreaterThanOrEqual(1024);
    expect(port + 5688).toBeLessThanOrEqual(65534);
  });
});
