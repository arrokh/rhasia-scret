import { expect, test } from "@playwright/test";
import { argon2id } from "hash-wasm";
import {
  encryptPayloadWithContext,
  serializeEncryptedEnvelope,
} from "@/modules/crypto/infrastructure/browser-crypto-envelope";

test.describe("encrypted read-only offline PWA", () => {
  test("uses the configured manifest and boots only the public offline shell from a static cache", async ({
    page,
    context,
  }) => {
    await page.goto("/offline");
    await expect(page.getByRole("heading", { name: "Akses brankas luring" })).toBeVisible();

    const manifest = await page.evaluate(async () =>
      fetch("/manifest.webmanifest").then((response) => response.json()),
    );
    expect(manifest).toMatchObject({
      name: "rhasia-scret",
      short_name: "rhasia-scret",
      display: "standalone",
      orientation: "portrait",
    });
    expect(manifest.icons.length).toBeGreaterThan(0);

    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("pwa-activation-preservation", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("marker");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const transaction = request.result.transaction("marker", "readwrite");
          transaction.objectStore("marker").put("preserved", "state");
          transaction.oncomplete = () => {
            request.result.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.evaluate(() => navigator.serviceWorker.ready);

    const cachedUrls = await page.evaluate(async () => {
      const names = await caches.keys();
      const owned = names.filter((name) => name.startsWith("rhasia-scret-static-"));
      return (await Promise.all(owned.map(async (name) => (await caches.open(name)).keys())))
        .flat()
        .map((request) => new URL(request.url).pathname);
    });
    expect(cachedUrls).toContain("/offline");
    expect(cachedUrls).toContain("/");
    expect(cachedUrls.some((url) => url.startsWith("/_next/static/"))).toBe(true);
    expect(cachedUrls.some((url) => url.startsWith("/api/v1/") || url.startsWith("/auth/"))).toBe(false);

    await context.setOffline(true);
    await page.goto("/vaults", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Akses brankas luring" })).toBeVisible();
    await expect(page.getByText("Mode baca-saja")).toBeVisible();

    const marker = await page.evaluate(
      async () =>
        new Promise<string | undefined>((resolve, reject) => {
          const request = indexedDB.open("pwa-activation-preservation", 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const transaction = request.result.transaction("marker", "readonly");
            const get = transaction.objectStore("marker").get("state");
            get.onsuccess = () => {
              request.result.close();
              resolve(get.result as string | undefined);
            };
            get.onerror = () => reject(get.error);
          };
        }),
    );
    expect(marker).toBe("preserved");

    test.info().annotations.push({
      type: "capability",
      description:
        "Vault Unlock Secret is the baseline; WebAuthn PRF Remembered Browser requires platform capability and real-device verification.",
    });
  });

  test("keeps the previous offline shells when one locale refresh fails", async ({ page, context, baseURL }) => {
    if (!baseURL) throw new Error("The browser test base URL is unavailable.");
    await context.addCookies([{ name: "RHSIA_LOCALE", value: "id", url: baseURL }]);
    await page.goto("/offline");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) throw new Error("The offline page is not controlled by its worker.");
    });
    const previousShells = await page.evaluate(async () => {
      const cacheName = (await caches.keys()).find((name) => name.startsWith("rhasia-scret-static-"));
      if (!cacheName) throw new Error("The static app cache is unavailable.");
      const cache = await caches.open(cacheName);
      const landingShell = await cache.match("/");
      const offlineShell = await cache.match("/offline");
      if (!landingShell || !offlineShell) throw new Error("The navigation shells are not cached.");
      return [await landingShell.text(), await offlineShell.text()];
    });
    await context.addCookies([{ name: "RHSIA_LOCALE", value: "en", url: baseURL }]);
    await context.route("**/offline", (route) => route.abort());
    const refreshResult = await page.evaluate(
      () =>
        new Promise<string>((resolve, reject) => {
          const controller = navigator.serviceWorker.controller;
          if (!controller) {
            reject(new Error("The service worker controller is unavailable."));
            return;
          }
          const channel = new MessageChannel();
          const timeout = window.setTimeout(() => reject(new Error("The worker did not reply.")), 10_000);
          channel.port1.onmessage = (event: MessageEvent<{ type?: string }>) => {
            window.clearTimeout(timeout);
            resolve(event.data?.type ?? "missing-response");
            channel.port1.close();
            channel.port2.close();
          };
          controller.postMessage({ type: "RHSIA_REFRESH_OFFLINE_SHELL", locale: "en" }, [channel.port2]);
        }),
    );
    await context.unroute("**/offline");
    const currentShells = await page.evaluate(async () => {
      const cacheName = (await caches.keys()).find((name) => name.startsWith("rhasia-scret-static-"));
      if (!cacheName) throw new Error("The static app cache is unavailable.");
      const cache = await caches.open(cacheName);
      const landingShell = await cache.match("/");
      const offlineShell = await cache.match("/offline");
      if (!landingShell || !offlineShell) throw new Error("The navigation shells are not cached.");
      return [await landingShell.text(), await offlineShell.text()];
    });

    expect(refreshResult).toBe("RHSIA_OFFLINE_SHELL_REFRESH_FAILED");
    expect(currentShells).toEqual(previousShells);
  });

  test("restores every owned offline shell when a later cache write fails", async ({ page, context, baseURL }) => {
    if (!baseURL) throw new Error("The browser test base URL is unavailable.");
    await context.addCookies([{ name: "RHSIA_LOCALE", value: "id", url: baseURL }]);
    await page.goto("/offline");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) throw new Error("The offline page is not controlled by its worker.");
    });

    const olderCacheNames = ["rhasia-scret-static-review-first", "rhasia-scret-static-review-failing"];
    const previousShells = await page.evaluate(async (cacheNames) => {
      for (const cacheName of cacheNames) {
        const cache = await caches.open(cacheName);
        for (const pathname of ["/", "/offline"]) {
          await cache.put(
            pathname,
            new Response(`<html lang="id"><body>${cacheName}:${pathname}</body></html>`, {
              headers: { "content-type": "text/html; charset=utf-8" },
            }),
          );
        }
      }
      const ownedNames = (await caches.keys()).filter((name) => name.startsWith("rhasia-scret-static-"));
      return Promise.all(
        ownedNames.map(async (cacheName) => {
          const cache = await caches.open(cacheName);
          const [landingShell, offlineShell] = await Promise.all([cache.match("/"), cache.match("/offline")]);
          return [
            cacheName,
            [landingShell ? await landingShell.text() : null, offlineShell ? await offlineShell.text() : null],
          ] as const;
        }),
      );
    }, olderCacheNames);

    const worker = context.serviceWorkers().find((candidate) => candidate.url().endsWith("/sw.js"));
    if (!worker) throw new Error("The offline page service worker is unavailable.");
    await worker.evaluate((failingCacheName) => {
      const originalOpen = caches.open.bind(caches);
      let failurePending = true;
      Object.defineProperty(caches, "open", {
        configurable: true,
        value: async (cacheName: string) => {
          const cache = await originalOpen(cacheName);
          if (cacheName !== failingCacheName) return cache;
          return new Proxy(cache, {
            get(target, property) {
              if (property === "put") {
                return (request: RequestInfo | URL, response: Response) => {
                  const pathname =
                    request instanceof Request
                      ? new URL(request.url).pathname
                      : new URL(String(request), self.location.origin).pathname;
                  if (failurePending && pathname === "/offline") {
                    failurePending = false;
                    throw new DOMException("Synthetic cache write failure.", "QuotaExceededError");
                  }
                  return target.put(request, response);
                };
              }
              const value = Reflect.get(target, property, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        },
      });
    }, olderCacheNames[1]);

    await context.addCookies([{ name: "RHSIA_LOCALE", value: "en", url: baseURL }]);
    const refreshResult = await page.evaluate(
      () =>
        new Promise<string>((resolve, reject) => {
          const controller = navigator.serviceWorker.controller;
          if (!controller) {
            reject(new Error("The service worker controller is unavailable."));
            return;
          }
          const channel = new MessageChannel();
          const timeout = window.setTimeout(() => reject(new Error("The worker did not reply.")), 10_000);
          channel.port1.onmessage = (event: MessageEvent<{ type?: string }>) => {
            window.clearTimeout(timeout);
            resolve(event.data?.type ?? "missing-response");
            channel.port1.close();
            channel.port2.close();
          };
          controller.postMessage({ type: "RHSIA_REFRESH_OFFLINE_SHELL", locale: "en" }, [channel.port2]);
        }),
    );
    const currentShells = await page.evaluate(async (cacheSnapshots) => {
      const cacheNames = cacheSnapshots.map(([cacheName]) => cacheName);
      return Promise.all(
        cacheNames.map(async (cacheName) => {
          const cache = await caches.open(cacheName);
          const [landingShell, offlineShell] = await Promise.all([cache.match("/"), cache.match("/offline")]);
          return [
            cacheName,
            [landingShell ? await landingShell.text() : null, offlineShell ? await offlineShell.text() : null],
          ] as const;
        }),
      );
    }, previousShells);

    expect(refreshResult).toBe("RHSIA_OFFLINE_SHELL_REFRESH_FAILED");
    expect(currentShells).toEqual(previousShells);
  });

  test("fails closed when offline-shell rollback also fails", async ({ page, context, baseURL }) => {
    if (!baseURL) throw new Error("The browser test base URL is unavailable.");
    await context.addCookies([{ name: "RHSIA_LOCALE", value: "id", url: baseURL }]);
    await page.goto("/offline");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) throw new Error("The offline page is not controlled by its worker.");
    });

    const failingCacheName = "rhasia-scret-static-review-rollback-failing";
    await page.evaluate(async (cacheName) => {
      const cache = await caches.open(cacheName);
      for (const pathname of ["/", "/offline"])
        await cache.put(
          pathname,
          new Response(`<html lang="id"><body>${pathname}</body></html>`, {
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
        );
    }, failingCacheName);

    const worker = context.serviceWorkers().find((candidate) => candidate.url().endsWith("/sw.js"));
    if (!worker) throw new Error("The offline page service worker is unavailable.");
    await worker.evaluate((cacheName) => {
      const originalOpen = caches.open.bind(caches);
      let offlinePutFailuresRemaining = 3;
      Object.defineProperty(caches, "open", {
        configurable: true,
        value: async (name: string) => {
          const cache = await originalOpen(name);
          if (name !== cacheName) return cache;
          return new Proxy(cache, {
            get(target, property) {
              if (property === "put")
                return (request: RequestInfo | URL, response: Response) => {
                  const pathname =
                    request instanceof Request
                      ? new URL(request.url).pathname
                      : new URL(String(request), self.location.origin).pathname;
                  if (pathname === "/offline" && offlinePutFailuresRemaining > 0) {
                    offlinePutFailuresRemaining -= 1;
                    throw new DOMException("Synthetic cache write failure.", "QuotaExceededError");
                  }
                  return target.put(request, response);
                };
              const value = Reflect.get(target, property, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        },
      });
    }, failingCacheName);

    await context.addCookies([{ name: "RHSIA_LOCALE", value: "en", url: baseURL }]);
    const refreshResult = await page.evaluate(
      () =>
        new Promise<string>((resolve, reject) => {
          const controller = navigator.serviceWorker.controller;
          if (!controller) {
            reject(new Error("The service worker controller is unavailable."));
            return;
          }
          const channel = new MessageChannel();
          const timeout = window.setTimeout(() => reject(new Error("The worker did not reply.")), 10_000);
          channel.port1.onmessage = (event: MessageEvent<{ type?: string }>) => {
            window.clearTimeout(timeout);
            resolve(event.data?.type ?? "missing-response");
            channel.port1.close();
            channel.port2.close();
          };
          controller.postMessage({ type: "RHSIA_REFRESH_OFFLINE_SHELL", locale: "en" }, [channel.port2]);
        }),
    );
    const cacheState = await page.evaluate(async () => {
      const names = (await caches.keys()).filter((name) => name.startsWith("rhasia-scret-static-"));
      const shells = await Promise.all(
        names.map(async (name) => {
          const cache = await caches.open(name);
          const results = await Promise.all([cache.match("/"), cache.match("/offline")]);
          return [name, results.map((result) => Boolean(result))] as const;
        }),
      );
      const currentName = names.find((name) => name.endsWith("-v8"));
      const marker = currentName
        ? await (await caches.open(currentName)).match("/__rhasia-offline-shell-refresh-in-progress")
        : null;
      return { shells, markerExists: Boolean(marker) };
    });

    expect(refreshResult).toBe("RHSIA_OFFLINE_SHELL_REFRESH_FAILED");
    expect(cacheState.shells.every(([, shellPresence]) => shellPresence.every((present) => !present))).toBe(true);
    expect(cacheState.markerExists).toBe(true);
  });

  test("serializes overlapping locale refreshes and commits the last requested locale", async ({
    page,
    context,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("The browser test base URL is unavailable.");
    await context.addCookies([{ name: "RHSIA_LOCALE", value: "en", url: baseURL }]);
    await page.goto("/offline");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) throw new Error("The offline page is not controlled by its worker.");
    });

    const olderCacheNames = ["rhasia-scret-static-review-locale-first", "rhasia-scret-static-review-locale-second"];
    await page.evaluate(async (cacheNames) => {
      for (const cacheName of cacheNames) {
        const cache = await caches.open(cacheName);
        for (const pathname of ["/", "/offline"])
          await cache.put(
            pathname,
            new Response(`<html lang="id"><body>${cacheName}:${pathname}</body></html>`, {
              headers: { "content-type": "text/html; charset=utf-8" },
            }),
          );
      }
    }, olderCacheNames);

    let releaseFirstFetch: (() => void) | undefined;
    let signalFirstFetch: (() => void) | undefined;
    let isFirstOfflineFetch = true;
    const firstFetchStarted = new Promise<void>((resolve) => {
      signalFirstFetch = resolve;
    });
    await context.route("**/offline", async (route) => {
      if (isFirstOfflineFetch) {
        isFirstOfflineFetch = false;
        await new Promise<void>((resolve) => {
          releaseFirstFetch = resolve;
          signalFirstFetch?.();
        });
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: '<html lang="en"><body>Synthetic offline shell</body></html>',
        });
        return;
      }
      await route.continue();
    });
    const requestRefresh = (locale: "id" | "en") =>
      page.evaluate(
        (requestedLocale) =>
          new Promise<string>((resolve, reject) => {
            const controller = navigator.serviceWorker.controller;
            if (!controller) {
              reject(new Error("The service worker controller is unavailable."));
              return;
            }
            const channel = new MessageChannel();
            const timeout = window.setTimeout(() => reject(new Error("The worker did not reply.")), 10_000);
            channel.port1.onmessage = (event: MessageEvent<{ type?: string }>) => {
              window.clearTimeout(timeout);
              resolve(event.data?.type ?? "missing-response");
              channel.port1.close();
              channel.port2.close();
            };
            controller.postMessage({ type: "RHSIA_REFRESH_OFFLINE_SHELL", locale: requestedLocale }, [channel.port2]);
          }),
        locale,
      );

    const firstRefresh = requestRefresh("en");
    await firstFetchStarted;
    await context.addCookies([{ name: "RHSIA_LOCALE", value: "id", url: baseURL }]);
    const secondRefresh = requestRefresh("id");
    if (!releaseFirstFetch) throw new Error("The first locale refresh did not reach the paused request.");
    releaseFirstFetch();
    const refreshResults = await Promise.all([firstRefresh, secondRefresh]);
    await context.unroute("**/offline");

    const cachedLocales = await page.evaluate(async () => {
      const names = (await caches.keys()).filter((name) => name.startsWith("rhasia-scret-static-"));
      return Promise.all(
        names.map(async (name) => {
          const cache = await caches.open(name);
          const locales = await Promise.all(
            ["/", "/offline"].map(async (pathname) => {
              const response = await cache.match(pathname);
              if (!response) return null;
              const html = await response.text();
              return html.match(/<html\b[^>]*\blang=["']([^"']+)["']/i)?.[1] ?? null;
            }),
          );
          return [name, locales] as const;
        }),
      );
    });

    expect(refreshResults).toEqual(["RHSIA_OFFLINE_SHELL_REFRESHED", "RHSIA_OFFLINE_SHELL_REFRESHED"]);
    expect(cachedLocales.length).toBeGreaterThanOrEqual(3);
    expect(cachedLocales.every(([, locales]) => locales.every((locale) => locale === "id"))).toBe(true);
  });

  for (const locale of ["id", "en"] as const) {
    test(`defers and safely applies a PWA update with an unlocked offline Vault (${locale})`, async ({
      page,
      context,
    }) => {
      test.setTimeout(60_000);
      const fixture = await encryptedFixture({ includeViewer: false, synchronizedAt: "2026-01-01T00:00:00.000Z" });
      await page.goto("/offline");
      await page.evaluate(() => navigator.serviceWorker.ready);
      await context.addCookies([{ name: "RHSIA_LOCALE", value: locale, url: new URL(page.url()).origin }]);
      await page.reload();
      await seedBundle(page, fixture.bundle);
      await page.reload();

      const profileLabel = locale === "id" ? "Profil lokal anonim" : "Anonymous local profile";
      const passphraseLabel = locale === "id" ? "Passphrase Brankas" : "Vault Passphrase";
      const unlockLabel = locale === "id" ? "Buka dengan Passphrase Brankas" : "Unlock with Vault Passphrase";
      const lockLabel = locale === "id" ? "Kunci" : "Lock";
      const updateTitle = locale === "id" ? "Pembaruan siap" : "Update ready";
      const laterLabel = locale === "id" ? "Nanti" : "Later";
      const updateLabel = locale === "id" ? "Perbarui sekarang" : "Update now";

      await expect(page.getByRole("combobox", { name: profileLabel })).toContainText("Snapshot 1");
      await page.getByRole("textbox", { name: passphraseLabel }).fill(fixture.secret);
      await page.getByRole("button", { name: unlockLabel }).click();
      await expect(page.getByText("Personal User", { exact: true })).toBeVisible();

      await installWaitingUpdate(page);

      await expect(page.getByRole("heading", { name: updateTitle })).toBeVisible();
      await page.getByRole("button", { name: laterLabel }).click();
      await expect(page.getByRole("heading", { name: updateTitle })).toHaveCount(0);

      await page.getByRole("button", { name: lockLabel }).click();
      await expect(page.getByRole("heading", { name: updateTitle })).toBeVisible();
      await page.getByRole("button", { name: updateLabel }).click();

      await expect(page.getByRole("textbox", { name: passphraseLabel })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("Personal User", { exact: true })).toHaveCount(0);
      expect(await storedBundleText(page)).toContain("profile_fixture");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
    });
  }

  test("waits for a pending Local Vault unlock to settle before activating a PWA update", async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(60_000);
    if (!baseURL) throw new Error("The browser test base URL is unavailable.");
    const localVaultName = "Synthetic update vault";
    await context.addCookies([{ name: "RHSIA_LOCALE", value: "en", url: baseURL }]);
    await page.goto("/local");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.locator("#local-vault-name").fill(localVaultName);
    await page.locator("#local-vault-passphrase").fill("synthetic-local-passphrase");
    await page.locator("#local-vault-passphrase-confirm").fill("synthetic-local-passphrase");
    await page.getByRole("button", { name: "Create Local Vault" }).click();
    await expect(page.getByRole("tab", { name: localVaultName })).toBeVisible({ timeout: 30_000 });

    await page.getByRole("tab", { name: "Add account" }).click();
    await page.getByRole("button", { name: "Advanced options" }).click();
    await page
      .locator("#manual-authenticator-uri")
      .fill("otpauth://totp/Example%3Aalice%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Example");
    await page.getByRole("button", { name: "Use manual URI" }).click();
    await page.getByRole("button", { name: "Save to Local Vault" }).click();
    await expect(page.getByText("alice@example.test", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Lock Local Vault", exact: true }).click();
    await expect(page.locator("#local-vault-unlock")).toBeVisible();

    await page.evaluate(() => {
      const originalDecrypt = crypto.subtle.decrypt.bind(crypto.subtle);
      let release: (() => void) | undefined;
      let paused = false;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      Object.defineProperty(window, "__unlockDecryptStarted", { configurable: true, writable: true, value: false });
      Object.defineProperty(window, "__releaseUnlockDecrypt", {
        configurable: true,
        value: () => release?.(),
      });
      Object.defineProperty(crypto.subtle, "decrypt", {
        configurable: true,
        value: async (algorithm: AlgorithmIdentifier, key: CryptoKey, data: BufferSource) => {
          if (!paused) {
            paused = true;
            Reflect.set(window, "__unlockDecryptStarted", true);
            await gate;
          }
          return originalDecrypt(algorithm, key, data);
        },
      });
    });
    await page.locator("#local-vault-unlock").fill("synthetic-local-passphrase");
    await page.getByRole("button", { name: "Unlock Local Vault" }).click();
    await page.waitForFunction(() => Reflect.get(window, "__unlockDecryptStarted") === true);

    await installWaitingUpdate(page);
    await page.getByRole("button", { name: "Update now" }).click();
    await expect(page.getByRole("button", { name: "Updating…" })).toBeVisible();
    await expect(page.getByRole("tab", { name: localVaultName })).toHaveCount(0);
    await expect(page.locator("#local-vault-unlock")).toBeVisible();
    await expect
      .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.scriptURL))
      .toContain("/pwa-update-worker");

    const reloaded = page.waitForEvent("framenavigated", { timeout: 20_000 });
    await page.evaluate(() => {
      const release = Reflect.get(window, "__releaseUnlockDecrypt");
      if (typeof release === "function") release();
    });
    await reloaded;
    await expect(page.locator("#local-vault-unlock")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("alice@example.test", { exact: true })).toHaveCount(0);
  });

  test("waits for a Local Vault archive export before activating a PWA update", async ({ page, context, baseURL }) => {
    test.setTimeout(60_000);
    if (!baseURL) throw new Error("The browser test base URL is unavailable.");
    const localVaultName = "Synthetic export vault";
    await page.addInitScript(() => {
      let pauseNextDecrypt = false;
      let release: (() => void) | undefined;
      let paused = false;
      const originalDecrypt = crypto.subtle.decrypt.bind(crypto.subtle);
      Object.defineProperty(window, "__pauseArchiveDecrypt", {
        configurable: true,
        value: () => {
          pauseNextDecrypt = true;
        },
      });
      Object.defineProperty(window, "__archiveDecryptStarted", {
        configurable: true,
        writable: true,
        value: false,
      });
      Object.defineProperty(window, "__releaseArchiveDecrypt", {
        configurable: true,
        value: () => release?.(),
      });
      Object.defineProperty(crypto.subtle, "decrypt", {
        configurable: true,
        value: async (algorithm: AlgorithmIdentifier, key: CryptoKey, data: BufferSource) => {
          if (pauseNextDecrypt && !paused) {
            paused = true;
            Reflect.set(window, "__archiveDecryptStarted", true);
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
          return originalDecrypt(algorithm, key, data);
        },
      });
    });
    await context.addCookies([{ name: "RHSIA_LOCALE", value: "en", url: baseURL }]);
    await page.goto("/local");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.locator("#local-vault-name").fill(localVaultName);
    await page.locator("#local-vault-passphrase").fill("synthetic-local-passphrase");
    await page.locator("#local-vault-passphrase-confirm").fill("synthetic-local-passphrase");
    await page.getByRole("button", { name: "Create Local Vault" }).click();
    await expect(page.getByRole("tab", { name: localVaultName })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: "Add account" }).click();
    await page.getByRole("button", { name: "Advanced options" }).click();
    await page
      .locator("#manual-authenticator-uri")
      .fill("otpauth://totp/Example%3Aalice%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Example");
    await page.getByRole("button", { name: "Use manual URI" }).click();
    await page.getByRole("button", { name: "Save to Local Vault" }).click();
    await expect(page.getByText("alice@example.test", { exact: true })).toBeVisible();

    await page.getByRole("tab", { name: "Backup" }).click();
    let downloadCount = 0;
    page.on("download", () => {
      downloadCount += 1;
    });
    await page.evaluate(() => {
      const pause = Reflect.get(window, "__pauseArchiveDecrypt");
      if (typeof pause === "function") pause();
    });
    await page.getByRole("button", { name: "Export encrypted backup" }).click();
    await page.waitForFunction(() => Reflect.get(window, "__archiveDecryptStarted") === true);
    await installWaitingUpdate(page);
    await expect(page.getByRole("heading", { name: "Update ready" })).toBeVisible();

    await page.getByRole("button", { name: "Update now" }).click();
    await expect(page.getByRole("button", { name: "Updating…" })).toBeVisible();
    await expect(page.locator("#local-vault-unlock")).toBeVisible();
    await expect
      .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.scriptURL))
      .toContain("/pwa-update-worker");

    const reloaded = page.waitForEvent("framenavigated", { timeout: 20_000 });
    await page.evaluate(() => {
      const release = Reflect.get(window, "__releaseArchiveDecrypt");
      if (typeof release === "function") release();
    });
    await reloaded;
    await expect(page.locator("#local-vault-unlock")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("alice@example.test", { exact: true })).toHaveCount(0);
    expect(downloadCount).toBe(0);
  });

  test("asks before opening offline access from an active page", async ({ page, context }) => {
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await context.setOffline(true);

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Buka akses luring?" })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);

    await page.getByRole("button", { name: "Buka brankas luring" }).click();
    await expect(page.getByRole("heading", { name: "Akses brankas luring" })).toBeVisible();
    await expect(page).toHaveURL(/\/offline\/?$/);
  });

  test("keeps the landing page and asks before offline access on a direct reload", async ({ page, context }) => {
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Buka akses luring?" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Akses brankas luring" })).toHaveCount(0);
  });

  test("refreshes a waiting worker and boots the offline shell in the selected English locale", async ({
    page,
    context,
  }) => {
    await page.goto("/offline");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.evaluate(async () => {
      const legacyCache = await caches.open("rhasia-scret-static-v0-locale-test");
      await legacyCache.put("/", new Response('<html lang="id"><body>Old landing shell</body></html>'));
      await legacyCache.put("/offline", new Response('<html lang="id"><body>Old offline shell</body></html>'));
    });
    await installWaitingUpdate(page);
    await page.getByRole("button", { name: "Pilih bahasa" }).click();
    await page.getByRole("menuitemradio", { name: "English" }).click();
    await page.getByRole("button", { name: "Ganti bahasa" }).click();
    await expect(page.getByRole("button", { name: "Choose language" })).toContainText("Language");
    await expect(page.getByRole("button", { name: "Choose language" })).toHaveAttribute(
      "title",
      "Current language: English",
    );
    await expect(page.getByRole("heading", { name: "Offline vault access" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect
      .poll(() => page.evaluate(async () => (await caches.match("/offline"))?.text()))
      .toContain("Offline vault access");
    const legacyShells = await page.evaluate(async () => {
      const legacyCache = await caches.open("rhasia-scret-static-v0-locale-test");
      return Promise.all(
        [await legacyCache.match("/"), await legacyCache.match("/offline")].map(async (response) =>
          response ? response.text() : null,
        ),
      );
    });
    expect(legacyShells.every((html) => html?.includes('lang="en"'))).toBe(true);
    await expect(page.getByRole("heading", { name: "Update ready" })).toBeVisible();
    await page.getByRole("button", { name: "Update now" }).click();
    await expect(page.getByRole("heading", { name: "Offline vault access" })).toBeVisible({ timeout: 20_000 });

    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Offline vault access" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("unlocks ciphertext offline, generates OTPs, retains stale data on failures, and reconciles revocation only after complete success", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const initial = await encryptedFixture({ includeViewer: true, synchronizedAt: "2026-01-01T00:00:00.000Z" });
    const reconciled = await encryptedFixture({ includeViewer: false, synchronizedAt: "2026-01-02T00:00:00.000Z" });

    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/offline");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await seedBundle(page, initial.bundle);
    await page.reload();
    await expect(page.getByRole("combobox", { name: "Profil lokal anonim" })).toContainText("Snapshot 1");

    await context.setOffline(true);
    await page.reload();
    await page.getByRole("textbox", { name: "Passphrase Brankas" }).fill(initial.secret);
    await page.getByRole("button", { name: "Buka dengan Passphrase Brankas" }).click();
    await expect(page.getByRole("heading", { name: "Akun autentikator luring" })).toBeVisible({ timeout: 20_000 });
    const copiedCodes: string[] = [];
    for (const account of initial.accounts) {
      await expect(page.getByText(account.accountName)).toBeVisible();
      const copy = page.getByRole("button", { name: `Salin OTP untuk ${account.accountName}, ${account.issuer}` });
      await copy.click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/^\d{6}$/);
      copiedCodes.push(await page.evaluate(() => navigator.clipboard.readText()));
    }
    await expect(page.getByText(/pemeriksaan drift dan audit akses tidak tersedia/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Tambah akun/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Kelola/ })).toHaveCount(0);

    const persisted = await storedBundleText(page);
    for (const plaintext of [
      ...initial.accounts.flatMap((account) => [account.issuer, account.accountName, account.secretBase64]),
      ...initial.vaultNames,
      ...initial.sensitiveValues,
      ...copiedCodes,
    ]) {
      expect(persisted).not.toContain(plaintext);
    }

    await page.route("**/api/v1/sync/workspace-bundle", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "unauthenticated" }),
      }),
    );
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByRole("heading", { name: "Akses brankas luring" })).toBeVisible();
    await expect(page.getByText("Viewer User", { exact: true })).toHaveCount(0);

    await context.setOffline(true);
    await page.getByRole("textbox", { name: "Passphrase Brankas" }).fill(initial.secret);
    await page.getByRole("button", { name: "Buka dengan Passphrase Brankas" }).click();
    await expect(page.getByRole("heading", { name: "Akun autentikator luring" })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.unroute("**/api/v1/sync/workspace-bundle");
    await page.route("**/api/v1/sync/workspace-bundle", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ responseVersion: 999 }) }),
    );
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByRole("status").filter({ hasText: "Sinkronisasi gagal atau usang" })).toBeVisible();
    await expect(page.getByText("Viewer User", { exact: true })).toHaveCount(0);

    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.unroute("**/api/v1/sync/workspace-bundle");
    let reconciledRequests = 0;
    await page.route("**/api/v1/sync/workspace-bundle", (route) => {
      reconciledRequests += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(reconciled.workspace),
      });
    });
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => reconciledRequests).toBeGreaterThan(0);
    await expect(page.getByRole("status").filter({ hasText: "Daring dan terkini" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Viewer User", { exact: true })).toHaveCount(0);
    expect(await storedBundleText(page)).toContain("2026-01-02T00:00:00.000Z");

    await page.getByRole("button", { name: "Kunci" }).click();
    await expect(page.getByRole("heading", { name: "Akses brankas luring" })).toBeVisible();
    await expect(page.getByText("Personal User", { exact: true })).toHaveCount(0);
  });
});

type FixtureAccount = { issuer: string; accountName: string; secretBase64: string };
type FixtureBundle = {
  bundle: Record<string, unknown>;
  workspace: Record<string, unknown>;
  secret: string;
  accounts: FixtureAccount[];
  vaultNames: string[];
  sensitiveValues: string[];
};

async function encryptedFixture({
  includeViewer,
  synchronizedAt,
}: {
  includeViewer: boolean;
  synchronizedAt: string;
}): Promise<FixtureBundle> {
  const secret = "correct horse battery staple";
  const salt = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
  const unlockKey = await argon2id({
    password: secret,
    salt,
    parallelism: 1,
    iterations: 3,
    memorySize: 64 * 1024,
    hashLength: 32,
    outputType: "binary",
  });
  if (typeof unlockKey === "string") throw new Error("Expected binary Argon2id output.");
  const userRootKey = Uint8Array.from({ length: 32 }, (_, index) => 31 - index);
  const personalKey = Uint8Array.from({ length: 32 }, (_, index) => 90 + index);
  const ownerKey = Uint8Array.from({ length: 32 }, (_, index) => 130 + index);
  const viewerKey = Uint8Array.from({ length: 32 }, (_, index) => 170 + index);
  const encrypted = (
    key: Uint8Array,
    plaintext: Uint8Array,
    context: Parameters<typeof encryptPayloadWithContext>[2],
  ) => encryptEnvelope(key, plaintext, context);
  const account = async (vaultId: string, id: string, issuer: string, accountName: string, key: Uint8Array) => {
    const secretBytes = Uint8Array.from({ length: 20 }, (_, index) => index + id.length);
    const configuration = {
      issuer,
      accountName,
      secret: base64(secretBytes),
      algorithm: "SHA-1",
      digits: 6,
      period: 30,
    };
    return {
      record: {
        id,
        encryptedPayload: base64(
          await encrypted(key, new TextEncoder().encode(JSON.stringify(configuration)), {
            purpose: "authenticator-account",
            payloadType: "totp-configuration",
            vaultId,
            keyVersion: 1,
          }),
        ),
        encryptionVersion: 1,
        revision: 1,
      },
      fixture: { issuer, accountName, secretBase64: configuration.secret },
    };
  };
  const personalAccount = await account(
    "personal_vault",
    "personal_account",
    "Personal Issuer",
    "Personal User",
    personalKey,
  );
  const ownerAccount = await account("owner_vault", "owner_account", "Owner Issuer", "Owner User", ownerKey);
  const viewerAccount = await account("viewer_vault", "viewer_account", "Viewer Issuer", "Viewer User", viewerKey);
  const sharedVault = async (
    vaultId: string,
    name: string,
    role: "OWNER" | "VIEWER",
    key: Uint8Array,
    record: Record<string, unknown>,
  ) => ({
    vaultId,
    lifecycle: "ACTIVE",
    role,
    effectiveAccountPermissions: {
      permissions: {
        canAddAccounts: role === "OWNER",
        canEditAccounts: role === "OWNER",
        canDeleteAccounts: role === "OWNER",
      },
      sources: {
        canAddAccounts: role === "OWNER" ? "OWNER" : "VAULT",
        canEditAccounts: role === "OWNER" ? "OWNER" : "VAULT",
        canDeleteAccounts: role === "OWNER" ? "OWNER" : "VAULT",
      },
    },
    encryptedName: base64(
      await encrypted(key, new TextEncoder().encode(name), {
        purpose: "vault-name",
        payloadType: "vault-name",
        vaultId,
        keyVersion: 1,
      }),
    ),
    encryptionVersion: 1,
    encryptedVaultKey: base64(
      await encrypted(userRootKey, key, {
        purpose: "vault-key-wrap",
        payloadType: "vault-encryption-key",
        vaultId,
        keyVersion: 1,
      }),
    ),
    keyVersion: 1,
    accounts: [record],
  });
  const sharedVaults = [await sharedVault("owner_vault", "Owner Vault", "OWNER", ownerKey, ownerAccount.record)];
  if (includeViewer)
    sharedVaults.push(await sharedVault("viewer_vault", "Viewer Vault", "VIEWER", viewerKey, viewerAccount.record));
  const personalSnapshot = {
    schemaVersion: 3,
    profileId: "profile_fixture",
    synchronizedAt,
    synchronizationToken: `personal-${synchronizedAt}`,
    cryptoProfile: {
      vaultUnlockSalt: base64(salt),
      wrappedUserRootKey: base64(
        await encrypted(unlockKey, userRootKey, {
          purpose: "user-root-key-wrap",
          payloadType: "user-root-key",
          keyVersion: 1,
        }),
      ),
      encryptedPersonalVaultKey: base64(
        await encrypted(userRootKey, personalKey, {
          purpose: "vault-key-wrap",
          payloadType: "vault-encryption-key",
          keyVersion: 1,
        }),
      ),
      encryptionVersion: 1,
    },
    personalVault: {
      vaultId: "personal_vault",
      lifecycle: "ACTIVE",
      encryptedName: base64(
        await encrypted(personalKey, new TextEncoder().encode("Personal Vault"), {
          purpose: "vault-name",
          payloadType: "vault-name",
          keyVersion: 1,
        }),
      ),
      encryptionVersion: 1,
      accounts: [personalAccount.record],
    },
  };
  const workspace = {
    responseVersion: 1,
    workspaceSynchronizationToken: synchronizedAt,
    synchronizedAt,
    personalSnapshot,
    sharedVaults,
  };
  unlockKey.fill(0);
  return {
    bundle: personalSnapshot,
    workspace,
    secret,
    accounts: [personalAccount.fixture],
    vaultNames: includeViewer ? ["Personal Vault", "Owner Vault", "Viewer Vault"] : ["Personal Vault", "Owner Vault"],
    sensitiveValues: [secret, base64(userRootKey), base64(personalKey), base64(ownerKey), base64(viewerKey)],
  };
}

async function installWaitingUpdate(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/pwa-update-worker", { scope: "/", updateViaCache: "none" });
    const registration = await navigator.serviceWorker.ready;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("The updated worker did not reach the waiting state.")),
        15_000,
      );
      const inspect = () => {
        if (!registration.waiting) return;
        window.clearTimeout(timeout);
        resolve();
      };
      const observeInstallingWorker = () => registration.installing?.addEventListener("statechange", inspect);
      registration.addEventListener("updatefound", observeInstallingWorker, { once: true });
      observeInstallingWorker();
      inspect();
    });
  });
}

async function encryptEnvelope(
  keyBytes: Uint8Array,
  plaintext: Uint8Array,
  context: Parameters<typeof encryptPayloadWithContext>[2],
): Promise<Uint8Array> {
  return serializeEncryptedEnvelope(await encryptPayloadWithContext(keyBytes, plaintext, context));
}

async function seedBundle(page: import("@playwright/test").Page, bundle: Record<string, unknown>) {
  await page.evaluate(
    async (value) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("rhasia-scret-offline-vault", 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("encrypted-snapshots"))
            request.result.createObjectStore("encrypted-snapshots", { keyPath: "profileId" });
          if (!request.result.objectStoreNames.contains("remembered-browsers"))
            request.result.createObjectStore("remembered-browsers", { keyPath: "profileId" });
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const transaction = request.result.transaction("encrypted-snapshots", "readwrite");
          transaction.objectStore("encrypted-snapshots").put(value);
          transaction.oncomplete = () => {
            request.result.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    bundle,
  );
}

async function storedBundleText(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(
    async () =>
      new Promise<string>((resolve, reject) => {
        const request = indexedDB.open("rhasia-scret-offline-vault", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const transaction = request.result.transaction("encrypted-snapshots", "readonly");
          const all = transaction.objectStore("encrypted-snapshots").getAll();
          all.onsuccess = () => {
            request.result.close();
            resolve(JSON.stringify(all.result));
          };
          all.onerror = () => reject(all.error);
        };
      }),
  );
}

function base64(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}
