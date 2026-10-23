const CACHE_VERSION = "rhasia-scret-static-v7";
const OWNED_CACHE_PREFIX = "rhasia-scret-static-";
const LANDING_SHELL = "/";
const OFFLINE_SHELL = "/offline";
const OFFLINE_NAVIGATION_DETECTED = "RHSIA_OFFLINE_NAVIGATION_DETECTED";
const OFFLINE_SHELL_REFRESHED = "RHSIA_OFFLINE_SHELL_REFRESHED";
const OFFLINE_SHELL_REFRESH_FAILED = "RHSIA_OFFLINE_SHELL_REFRESH_FAILED";
const PRECACHE = ["/manifest.webmanifest", "/pwa/icon512_rounded.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(precachePublicShells());
});

async function precachePublicShells() {
  const cache = await caches.open(CACHE_VERSION);
  await cache.addAll(PRECACHE);
  const shells = await Promise.all([LANDING_SHELL, OFFLINE_SHELL].map((pathname) => fetchNavigationShell(pathname)));
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
  return { pathname, response, resources };
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
    event.waitUntil(refreshOfflineShell(event));
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
    let cache = await caches.open(CACHE_VERSION);
    let cachedShellsMatch = await Promise.all(
      [LANDING_SHELL, OFFLINE_SHELL].map((pathname) => cachedShellMatchesLocale(cache, pathname, requestedLocale)),
    );
    if (!cachedShellsMatch.every(Boolean)) {
      await precachePublicShells();
      cache = await caches.open(CACHE_VERSION);
      cachedShellsMatch = await Promise.all(
        [LANDING_SHELL, OFFLINE_SHELL].map((pathname) => cachedShellMatchesLocale(cache, pathname, requestedLocale)),
      );
      if (!cachedShellsMatch.every(Boolean)) throw new Error("The offline shell locale could not be verified.");
    }
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
  try {
    await precachePublicShells();
    replyPort?.postMessage({ type: OFFLINE_SHELL_REFRESHED });
  } catch {
    replyPort?.postMessage({ type: OFFLINE_SHELL_REFRESH_FAILED });
  } finally {
    replyPort?.close();
  }
}

async function cachedShellMatchesLocale(cache, pathname, locale) {
  const response = await cache.match(pathname);
  if (!response) return false;
  const html = await response.text();
  const cachedLocale = html.match(/<html\b[^>]*\blang=["']([^"']+)["']/i)?.[1];
  return cachedLocale === locale;
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
