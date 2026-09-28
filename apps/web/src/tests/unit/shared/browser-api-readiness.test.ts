import { describe, expect, it, vi } from "vitest";
import { waitForBrowserApi } from "../../../../scripts/browser-api-readiness";

describe("waitForBrowserApi", () => {
  it("fails promptly when the API process exits before becoming healthy", async () => {
    const healthProbe = vi.fn(async () => false);

    await expect(waitForBrowserApi("http://127.0.0.1:1", () => "API server exited (1).", healthProbe)).rejects.toThrow(
      "API server exited (1).",
    );
    expect(healthProbe).not.toHaveBeenCalled();
  });

  it("returns once the API health check succeeds", async () => {
    const healthProbe = vi.fn(async () => true);

    await expect(waitForBrowserApi("http://127.0.0.1:1", () => undefined, healthProbe)).resolves.toBeUndefined();
    expect(healthProbe).toHaveBeenCalledTimes(1);
  });
});
