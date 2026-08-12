import { withTimeout } from "./use-mobile-session";

describe("withTimeout", () => {
  afterEach(() => jest.useRealTimers());

  it("rejects a stalled native request", async () => {
    jest.useFakeTimers();
    const request = withTimeout(new Promise<never>(() => undefined), 15_000);
    jest.advanceTimersByTime(15_000);
    await expect(request).rejects.toThrow("timed out");
  });

  it("clears its timer when the request settles", async () => {
    jest.useFakeTimers();
    const request = withTimeout(Promise.resolve("ok"), 15_000);
    await expect(request).resolves.toBe("ok");
    expect(jest.getTimerCount()).toBe(0);
  });
});
