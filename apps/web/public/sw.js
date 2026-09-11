const CACHE_VERSION = "rhasia-scret-static-v5";
const OWNED_CACHE_PREFIX = "rhasia-scret-static-";
const LANDING_SHELL = "/";
const OFFLINE_SHELL = "/offline";
const OFFLINE_NAVIGATION_DETECTED = "RHSIA_OFFLINE_NAVIGATION_DETECTED";
const PRECACHE = ["/manifest.webmanifest", "/pwa/icon512_rounded.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(precachePublicShells().then(() => self.skipWaiting()));
});

async function precachePublicShells() {
  const cache = await caches.open(CACHE_VERSION);
  await cache.addAll(PRECACHE);
  await cacheNavigationShell(cache, LANDING_SHELL);
  await cacheNavigationShell(cache, OFFLINE_SHELL);
}

async function cacheNavigationShell(cache, pathname) {
  const response = await fetch(pathname, { cache: "reload", credentials: "include" });
  if (!response.ok || !response.headers.get("content-type")?.startsWith("text/html"))
    throw new Error(`Navigation shell could not be cached: ${pathname}`);
  await cache.put(pathname, response.clone());
  const html = await response.text();
  const resources = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => new URL(match[1], self.location.origin))
    .filter((url) => url.origin === self.location.origin && isCacheableStatic(url.pathname))
    .map((url) => url.href);
  await cache.addAll([...new Set(resources)]);
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
  if (event.data?.type !== "RHSIA_REFRESH_OFFLINE_SHELL") return;
  event.waitUntil(precachePublicShells());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/"))
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
