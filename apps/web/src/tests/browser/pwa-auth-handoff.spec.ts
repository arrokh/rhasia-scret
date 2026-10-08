import { expect, test } from "@playwright/test";

test("hands an external-browser session to a resumed PWA with isolated storage", async ({ browser, baseURL }) => {
  const pwa = await browser.newContext({ baseURL });
  const external = await browser.newContext({ baseURL });
  const handoff = { handoffId: "pwa-handoff-123456", verifier: "v".repeat(43) };
  let published = false;
  let accepted = false;
  // Keep the first poll pending until hydration is complete and the test clock is paused.
  let releaseInitialPoll: () => void = () => undefined;
  const initialPollReleased = new Promise<void>((resolve) => {
    releaseInitialPoll = resolve;
  });
  let announceInitialPollStarted: () => void = () => undefined;
  const initialPollStarted = new Promise<void>((resolve) => {
    announceInitialPollStarted = resolve;
  });
  let isInitialPoll = true;
  try {
    await pwa.addInitScript((pending) => {
      Object.defineProperty(navigator, "standalone", { value: true });
      sessionStorage.setItem("rhasia-scret:pwa-auth-handoff", JSON.stringify(pending));
    }, handoff);
    await pwa.route("**/api/v1/auth/pwa/session", async (route) => {
      expect(route.request().postDataJSON()).toEqual(handoff);
      if (isInitialPoll) {
        isInitialPoll = false;
        announceInitialPollStarted();
        await initialPollReleased;
      }
      accepted ||= published;
      await route.fulfill({
        status: published ? 200 : 202,
        contentType: "application/json",
        body: JSON.stringify(
          published ? { accepted: true, returnPath: "/vaults/invitations/redeem" } : { pending: true },
        ),
      });
    });
    await external.route("**/api/v1/auth/magic-link/redeem", async (route) => {
      expect(route.request().postDataJSON().client).toBe("pwa");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          refreshToken: "0123456789abcdef.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK",
          returnPath: "/vaults",
        }),
      });
    });
    await external.route("**/api/v1/auth/pwa/session", async (route) => {
      expect(route.request().postDataJSON().handoffId).toBe(handoff.handoffId);
      published = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ published: true }) });
    });
    const app = await pwa.newPage();
    await app.clock.install();
    const initialPollResponse = app.waitForResponse(
      (response) => response.url().endsWith("/api/v1/auth/pwa/session") && response.status() === 202,
    );
    await app.goto("/sign-in");
    await initialPollStarted;
    await app.clock.pauseAt(new Date(Date.now() + 100));
    releaseInitialPoll();
    await (await initialPollResponse).finished();
    await app.evaluate(() => new Promise<void>((resolve) => queueMicrotask(() => queueMicrotask(resolve))));
    const callback = await external.newPage();
    await callback.goto(
      "/auth/pwa-confirm#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK&handoff=pwa-handoff-123456",
    );
    await expect(callback.getByText("Tautan terverifikasi.", { exact: false })).toBeVisible();
    expect(await callback.evaluate(() => sessionStorage.getItem("rhasia-scret:pwa-auth-handoff"))).toBeNull();
    expect(new URL(callback.url()).hash).toBe("");
    // Paused timers ensure the scheduled poll cannot hide a missing resume listener.
    expect(accepted).toBe(false);
    await app.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    await expect.poll(() => accepted).toBe(true);
    await expect(app.getByText("Meneruskan sesi masuk ke aplikasi terpasang…")).toBeVisible();
    expect(await app.evaluate(() => sessionStorage.getItem("rhasia-scret:pwa-auth-handoff"))).toBeNull();
  } finally {
    await pwa.close();
    await external.close();
  }
});
