const CACHE_VERSION = "rhasia-scret-static-v1";
const OWNED_CACHE_PREFIX = "rhasia-scret-static-";
const OFFLINE_SHELL = "/offline";
const PRECACHE = [OFFLINE_SHELL, "/manifest.webmanifest", "/pwa/icon512_rounded.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(precacheOfflineShell().then(() => self.skipWaiting()));
});

async function precacheOfflineShell() {
  const cache = await caches.open(CACHE_VERSION);
  await cache.addAll(PRECACHE.slice(1));
  const response = await fetch(OFFLINE_SHELL, { cache: "reload" });
  if (!response.ok) throw new Error("Offline shell could not be cached.");
  await cache.put(OFFLINE_SHELL, response.clone());
  const html = await response.text();
  const resources = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => new URL(match[1], self.location.origin))
    .filter((url) => url.origin === self.location.origin && isCacheableStatic(url.pathname))
    .map((url) => url.href);
  await cache.addAll([...new Set(resources)]);
}

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((names) => Promise.all(names.filter((name) => name.startsWith(OWNED_CACHE_PREFIX) && name !== CACHE_VERSION).map((name) => caches.delete(name)))),
    self.clients.claim()
  ]));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (await caches.match(OFFLINE_SHELL)) || Response.error()));
    return;
  }

  if (!isCacheableStatic(url.pathname)) return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok && response.type === "basic") {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)));
    }
    return response;
  })));
});

function isCacheableStatic(pathname) {
  return pathname === "/manifest.webmanifest" || pathname.startsWith("/_next/static/") || pathname.startsWith("/pwa/");
}
