"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    if (process.env.NODE_ENV !== "production") {
      void removeDevelopmentServiceWorkers().catch(() => {
        // Development remains usable after a manual browser cache reset.
      });
      return;
    }
    let active = true;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        if (!active) return;
        void registration.update();
      })
      .catch(() => {
        // Offline access remains optional; unlock with the online application still works.
      });
    return () => {
      active = false;
    };
  }, []);
  return null;
}

async function removeDevelopmentServiceWorkers(): Promise<void> {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations
      .filter(
        (registration) =>
          registration.active?.scriptURL.endsWith("/sw.js") ||
          registration.waiting?.scriptURL.endsWith("/sw.js") ||
          registration.installing?.scriptURL.endsWith("/sw.js"),
      )
      .map((registration) => registration.unregister()),
  );
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames.filter((name) => name.startsWith("rhasia-scret-static-")).map((name) => caches.delete(name)),
  );
}
