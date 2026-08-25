import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configuredPlaywrightFullyParallel,
  configuredPlaywrightWorkers,
} from "../../browser/support/playwright-concurrency";

describe("Playwright concurrency configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts worker counts and percentage values", () => {
    vi.stubEnv("PLAYWRIGHT_WORKERS", "50%");
    expect(configuredPlaywrightWorkers(3)).toBe("50%");

    vi.stubEnv("PLAYWRIGHT_WORKERS", "4");
    expect(configuredPlaywrightWorkers(3)).toBe(4);
  });

  it("rejects invalid worker settings", () => {
    for (const value of ["0", "0%", "invalid"]) {
      vi.stubEnv("PLAYWRIGHT_WORKERS", value);
      expect(() => configuredPlaywrightWorkers(3)).toThrow("positive integer or percentage");
    }
  });

  it("supports explicit parallel and sequential modes", () => {
    vi.stubEnv("PLAYWRIGHT_FULLY_PARALLEL", "0");
    expect(configuredPlaywrightFullyParallel(true)).toBe(false);

    vi.stubEnv("PLAYWRIGHT_FULLY_PARALLEL", "true");
    expect(configuredPlaywrightFullyParallel(false)).toBe(true);
  });
});
