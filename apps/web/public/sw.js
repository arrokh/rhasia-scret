const CACHE_VERSION = "rhasia-scret-static-v8";
const OWNED_CACHE_PREFIX = "rhasia-scret-static-";
const LANDING_SHELL = "/";
const OFFLINE_SHELL = "/offline";
const OFFLINE_NAVIGATION_DETECTED = "RHSIA_OFFLINE_NAVIGATION_DETECTED";
const OFFLINE_SHELL_REFRESHED = "RHSIA_OFFLINE_SHELL_REFRESHED";
const OFFLINE_SHELL_REFRESH_FAILED = "RHSIA_OFFLINE_SHELL_REFRESH_FAILED";
const PRECACHE = ["/manifest.webmanifest", "/pwa/icon512_rounded.png"];
const OFFLINE_SHELL_REFRESH_MARKER = "/__rhasia-offline-shell-refresh-in-progress";
let offlineShellCachesUnsafe = false;
let offlineShellCacheQueue = Promise.resolve();

self.addEventListener("install", (event) => {
  event.waitUntil(precachePublicShells());
});

async function precachePublicShells(expectedLocale) {
  const cache = await caches.open(CACHE_VERSION);
  await cache.addAll(PRECACHE);
  const shells = await Promise.all([LANDING_SHELL, OFFLINE_SHELL].map((pathname) => fetchNavigationShell(pathname)));
  if (expectedLocale && shells.some((shell) => shell.locale !== expectedLocale))
    throw new Error("The fetched offline shells do not match the requested locale.");
  const resources = [...new Set(shells.flatMap((shell) => shell.resources))];
  await cache.addAll(resources);
  const previousShells = await Promise.all(shells.map(({ pathname }) => cache.match(pathname)));
  try {
    for (const shell of shells) await cache.put(shell.pathname, shell.response);
  } catch (error) {
    await Promise.all(
      shells.map(({ pathname }, index) => {
        const previous = previousShells[index];
        return previous ? cache.put(pathname, previous) : cache.delete(pathname);
      }),
    );
    throw error;
  }
}

async function fetchNavigationShell(pathname) {
  const response = await fetch(pathname, { cache: "reload", credentials: "include" });
  if (!response.ok || !response.headers.get("content-type")?.startsWith("text/html"))
    throw new Error(`Navigation shell could not be cached: ${pathname}`);
  const html = await response.clone().text();
  const resources = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => new URL(match[1], self.location.origin))
    .filter((url) => url.origin === self.location.origin && isCacheableStatic(url.pathname))
    .map((url) => url.href);
  return { pathname, response, resources, locale: readShellLocale(html) };
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names
              .filter((name) => name.startsWith(OWNED_CACHE_PREFIX) && name !== CACHE_VERSION)
              .map((name) => caches.delete(name)),
          ),
        ),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener("message", (event) => {
  if (event.origin !== self.location.origin) return;
  if (event.data?.type === "RHSIA_REFRESH_OFFLINE_SHELL") {
    event.waitUntil(enqueueOfflineShellCacheTask(() => refreshOfflineShell(event)));
    return;
  }
  if (event.data?.type !== "RHSIA_APPLY_WAITING_UPDATE") return;

  event.waitUntil(applyWaitingUpdate(event));
});

async function applyWaitingUpdate(event) {
  const replyPort = event.ports[0];
  if (!replyPort) return;

  const requestedLocale = event.data?.locale;
  if (requestedLocale !== "id" && requestedLocale !== "en") {
    replyPort.postMessage({ type: "RHSIA_PWA_UPDATE_BLOCKED" });
    replyPort.close();
    return;
  }

  try {
    await enqueueOfflineShellCacheTask(async () => {
      let cache = await caches.open(CACHE_VERSION);
      let cachedShellsMatch = await Promise.all(
        [LANDING_SHELL, OFFLINE_SHELL].map((pathname) => cachedShellMatchesLocale(cache, pathname, requestedLocale)),
      );
      if (!cachedShellsMatch.every(Boolean)) {
        await updateOfflineShellCaches(requestedLocale, false);
        cache = await caches.open(CACHE_VERSION);
        cachedShellsMatch = await Promise.all(
          [LANDING_SHELL, OFFLINE_SHELL].map((pathname) => cachedShellMatchesLocale(cache, pathname, requestedLocale)),
        );
        if (!cachedShellsMatch.every(Boolean)) throw new Error("The offline shell locale could not be verified.");
      }
    });
  } catch {
    replyPort.postMessage({ type: "RHSIA_PWA_UPDATE_BLOCKED" });
    replyPort.close();
    return;
  }

  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const preparedClients = await Promise.all(clients.map((client) => prepareClientForUpdate(client)));
  if (preparedClients.some((result) => !result.ready)) {
    for (const result of preparedClients) {
      result.port.postMessage({ type: "RHSIA_CANCEL_PWA_UPDATE" });
      result.port.close();
    }
    replyPort.postMessage({ type: "RHSIA_PWA_UPDATE_BLOCKED" });
    replyPort.close();
    return;
  }

  try {
    await self.skipWaiting();
    replyPort.postMessage({ type: "RHSIA_PWA_UPDATE_ACTIVATING" });
  } catch {
    for (const result of preparedClients) result.port.postMessage({ type: "RHSIA_CANCEL_PWA_UPDATE" });
    replyPort.postMessage({ type: "RHSIA_PWA_UPDATE_BLOCKED" });
  } finally {
    replyPort.close();
    for (const result of preparedClients) result.port.close();
  }
}

async function refreshOfflineShell(event) {
  const replyPort = event.ports[0];
  if (!replyPort) return;

  const requestedLocale = event.data?.locale;
  if (!isAppLocale(requestedLocale)) {
    replyPort.postMessage({ type: OFFLINE_SHELL_REFRESH_FAILED });
    replyPort.close();
    return;
  }

  try {
    await updateOfflineShellCaches(requestedLocale, true);
    replyPort.postMessage({ type: OFFLINE_SHELL_REFRESHED });
  } catch {
    replyPort.postMessage({ type: OFFLINE_SHELL_REFRESH_FAILED });
  } finally {
    replyPort.close();
  }
}

async function updateOfflineShellCaches(requestedLocale, refreshOlderCaches) {
  const previousShells = await snapshotOwnedOfflineShells();
  const markerCache = await caches.open(CACHE_VERSION);
  await markerCache.put(OFFLINE_SHELL_REFRESH_MARKER, new Response("refreshing"));
  offlineShellCachesUnsafe = true;

  try {
    await precachePublicShells(requestedLocale);
    if (refreshOlderCaches) await refreshOwnedOfflineShellCaches(requestedLocale);
    await markerCache.delete(OFFLINE_SHELL_REFRESH_MARKER);
    offlineShellCachesUnsafe = false;
  } catch (error) {
    try {
      await restoreOwnedOfflineShells(previousShells);
      await markerCache.delete(OFFLINE_SHELL_REFRESH_MARKER);
      offlineShellCachesUnsafe = false;
    } catch {
      offlineShellCachesUnsafe = true;
      try {
        await invalidateOwnedOfflineShells();
      } catch {
        // Keep the marker so offline navigation continues to fail closed.
      }
    }
    throw error;
  }
}

function enqueueOfflineShellCacheTask(operation) {
  const result = offlineShellCacheQueue.then(operation);
  offlineShellCacheQueue = result.catch(() => {});
  return result;
}

async function offlineShellCacheIsUnsafe() {
  if (offlineShellCachesUnsafe) return true;
  try {
    const cache = await caches.open(CACHE_VERSION);
    return Boolean(await cache.match(OFFLINE_SHELL_REFRESH_MARKER));
  } catch {
    return true;
  }
}

async function snapshotOwnedOfflineShells() {
  const cacheNames = (await caches.keys()).filter((name) => name.startsWith(OWNED_CACHE_PREFIX));
  return Promise.all(
    cacheNames.map(async (cacheName) => {
      const cache = await caches.open(cacheName);
      const shells = await Promise.all([LANDING_SHELL, OFFLINE_SHELL].map((pathname) => cache.match(pathname)));
      return { cacheName, shells };
    }),
  );
}

async function restoreOwnedOfflineShells(previousShells) {
  const previousByName = new Map(previousShells.map(({ cacheName, shells }) => [cacheName, shells]));
  const currentNames = (await caches.keys()).filter((name) => name.startsWith(OWNED_CACHE_PREFIX));
  const cacheNames = new Set([...previousByName.keys(), ...currentNames]);
  const cacheResults = await Promise.allSettled(
    [...cacheNames].map(async (cacheName) => {
      const cache = await caches.open(cacheName);
      const previous = previousByName.get(cacheName) ?? [];
      const shellResults = await Promise.allSettled(
        [LANDING_SHELL, OFFLINE_SHELL].map((pathname, index) => {
          const response = previous[index];
          return response ? cache.put(pathname, response) : cache.delete(pathname);
        }),
      );
      if (shellResults.some((result) => result.status === "rejected"))
        throw new Error("An offline shell cache could not be restored.");
    }),
  );
  if (cacheResults.some((result) => result.status === "rejected"))
    throw new Error("An offline shell cache could not be restored.");
}

async function invalidateOwnedOfflineShells() {
  const cacheNames = (await caches.keys()).filter((name) => name.startsWith(OWNED_CACHE_PREFIX));
  const cacheResults = await Promise.allSettled(
    cacheNames.map(async (cacheName) => {
      const cache = await caches.open(cacheName);
      const shellResults = await Promise.allSettled(
        [LANDING_SHELL, OFFLINE_SHELL].map((pathname) => cache.delete(pathname)),
      );
      if (shellResults.some((result) => result.status === "rejected"))
        throw new Error("An unsafe offline shell cache could not be invalidated.");
    }),
  );
  if (cacheResults.some((result) => result.status === "rejected"))
    throw new Error("An unsafe offline shell cache could not be invalidated.");
}

async function refreshOwnedOfflineShellCaches(requestedLocale) {
  const sourceCache = await caches.open(CACHE_VERSION);
  const [landingShell, offlineShell] = await Promise.all([
    sourceCache.match(LANDING_SHELL),
    sourceCache.match(OFFLINE_SHELL),
  ]);
  if (!landingShell || !offlineShell) throw new Error("The refreshed offline shells are unavailable.");
  const sourceShellsMatch = await Promise.all(
    [LANDING_SHELL, OFFLINE_SHELL].map((pathname) => cachedShellMatchesLocale(sourceCache, pathname, requestedLocale)),
  );
  if (!sourceShellsMatch.every(Boolean)) throw new Error("The refreshed offline shell locale could not be verified.");

  const cacheNames = await caches.keys();
  for (const cacheName of cacheNames) {
    if (!cacheName.startsWith(OWNED_CACHE_PREFIX) || cacheName === CACHE_VERSION) continue;
    const cache = await caches.open(cacheName);
    const previousShells = await Promise.all([cache.match(LANDING_SHELL), cache.match(OFFLINE_SHELL)]);
    try {
      await cache.put(LANDING_SHELL, landingShell.clone());
      await cache.put(OFFLINE_SHELL, offlineShell.clone());
    } catch (error) {
      await Promise.all(
        [LANDING_SHELL, OFFLINE_SHELL].map((pathname, index) => {
          const previous = previousShells[index];
          return previous ? cache.put(pathname, previous) : cache.delete(pathname);
        }),
      );
      throw error;
    }
  }
}

async function cachedShellMatchesLocale(cache, pathname, locale) {
  const response = await cache.match(pathname);
  if (!response) return false;
  return readShellLocale(await response.text()) === locale;
}

function readShellLocale(html) {
  return html.match(/<html\b[^>]*\blang=["']([^"']+)["']/i)?.[1] ?? null;
}

function isAppLocale(locale) {
  return locale === "id" || locale === "en";
}

function prepareClientForUpdate(client) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    const timeout = setTimeout(() => finish(false), 5000);
    channel.port1.onmessage = (event) => {
      if (event.data?.type === "RHSIA_PWA_UPDATE_CLIENT_READY") finish(true);
      if (event.data?.type === "RHSIA_PWA_UPDATE_CLIENT_BLOCKED") finish(false);
    };
    channel.port1.start();
    try {
      client.postMessage({ type: "RHSIA_PREPARE_FOR_PWA_UPDATE" }, [channel.port2]);
    } catch {
      finish(false);
    }

    function finish(ready) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ready, port: channel.port1 });
    }
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/v1/") ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/")
  )
    return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (!isCacheableStatic(url.pathname)) return;
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)));
          }
          return response;
        }),
    ),
  );
});

async function networkFirstNavigation(request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    return await fetch(request, { signal: controller.signal });
  } catch {
    const pathname = new URL(request.url).pathname;
    if (pathname !== OFFLINE_SHELL) await notifyOfflineClients();
    if (await offlineShellCacheIsUnsafe()) return Response.error();
    const fallbackShell = pathname === LANDING_SHELL ? LANDING_SHELL : OFFLINE_SHELL;
    return (await caches.match(fallbackShell)) || (await caches.match(OFFLINE_SHELL)) || Response.error();
  } finally {
    clearTimeout(timeout);
  }
}

async function notifyOfflineClients() {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) client.postMessage({ type: OFFLINE_NAVIGATION_DETECTED });
}

function isCacheableStatic(pathname) {
  return (
    !pathname.endsWith(".map") &&
    (pathname === "/manifest.webmanifest" || pathname.startsWith("/_next/static/") || pathname.startsWith("/pwa/"))
  );
}
