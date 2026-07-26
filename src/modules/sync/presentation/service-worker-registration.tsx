"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator) || !window.isSecureContext) return;
    let active = true;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then((registration) => {
      if (!active) return;
      void registration.update();
    }).catch(() => {
      // Offline access remains optional; unlock with the online application still works.
    });
    return () => { active = false; };
  }, []);
  return null;
}
