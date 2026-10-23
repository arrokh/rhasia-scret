"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { beginPwaUpdateLock, cancelPwaUpdateLock, subscribeToLocalVaultLock } from "@/modules/sync";
import { StatusBanner } from "@/shared/presentation/app-ui";

export const offlineNavigationDetectedMessage = "RHSIA_OFFLINE_NAVIGATION_DETECTED";
const prepareForUpdateMessage = "RHSIA_PREPARE_FOR_PWA_UPDATE";
const updateClientReadyMessage = "RHSIA_PWA_UPDATE_CLIENT_READY";
const cancelUpdateMessage = "RHSIA_CANCEL_PWA_UPDATE";
const applyUpdateMessage = "RHSIA_APPLY_WAITING_UPDATE";
const updateBlockedMessage = "RHSIA_PWA_UPDATE_BLOCKED";
const updateActivatingMessage = "RHSIA_PWA_UPDATE_ACTIVATING";

type WorkerMessage = { type?: unknown };

export function ServiceWorkerRegistration() {
  const t = useTranslations("Sync.updatePrompt");
  const locale = useLocale();
  const pathname = usePathname();
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [deferred, setDeferred] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyFailed, setApplyFailed] = useState(false);
  const waitingWorkerRef = useRef<ServiceWorker | null>(null);
  const shouldReloadRef = useRef(false);
  const applyTimeoutRef = useRef<number | null>(null);
  const previousPathnameRef = useRef(pathname);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    if (process.env.NODE_ENV !== "production") {
      void removeDevelopmentServiceWorkers().catch(() => {
        // Development remains usable after a manual browser cache reset.
      });
      return;
    }

    let active = true;
    let registration: ServiceWorkerRegistration | null = null;
    let installingWorker: ServiceWorker | null = null;

    const clearApplyTimeout = () => {
      if (applyTimeoutRef.current === null) return;
      window.clearTimeout(applyTimeoutRef.current);
      applyTimeoutRef.current = null;
    };

    const observeWaitingWorker = () => {
      if (!active) return;
      const candidate = registration?.waiting;
      if (!candidate || !registration?.active) {
        if (!candidate) {
          waitingWorkerRef.current = null;
          setWaitingWorker(null);
        }
        return;
      }
      if (candidate === waitingWorkerRef.current) return;
      waitingWorkerRef.current = candidate;
      setWaitingWorker(candidate);
      setDeferred(false);
      setApplyFailed(false);
    };

    const onInstallingStateChange = () => {
      if (installingWorker?.state === "installed") queueMicrotask(observeWaitingWorker);
      if (installingWorker?.state === "redundant") observeWaitingWorker();
    };

    const onUpdateFound = () => {
      installingWorker?.removeEventListener("statechange", onInstallingStateChange);
      installingWorker = registration?.installing ?? null;
      installingWorker?.addEventListener("statechange", onInstallingStateChange);
      observeWaitingWorker();
    };

    const onControllerChange = () => {
      if (!shouldReloadRef.current) return;
      clearApplyTimeout();
      window.location.reload();
    };

    const onServiceWorkerMessage = (event: MessageEvent<WorkerMessage>) => {
      if (event.origin !== window.location.origin) return;
      const port = event.ports[0];
      if (event.data?.type === prepareForUpdateMessage) {
        if (!port) return;
        shouldReloadRef.current = true;
        setApplying(true);
        port.onmessage = (portEvent: MessageEvent<WorkerMessage>) => {
          if (portEvent.data?.type !== cancelUpdateMessage) return;
          cancelPwaUpdateLock();
          shouldReloadRef.current = false;
          setApplying(false);
          setApplyFailed(true);
          setDeferred(false);
          clearApplyTimeout();
        };
        port.start();
        beginPwaUpdateLock();
        void import("../infrastructure/browser-vault-update-readiness")
          .then(({ waitForPendingVaultSensitiveOperations }) => waitForPendingVaultSensitiveOperations())
          .then(() => {
            if (shouldReloadRef.current) port.postMessage({ type: updateClientReadyMessage });
          });
        return;
      }
      if (event.data?.type === cancelUpdateMessage) {
        cancelPwaUpdateLock();
        shouldReloadRef.current = false;
        setApplying(false);
        setApplyFailed(true);
        setDeferred(false);
        clearApplyTimeout();
      }
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    navigator.serviceWorker.addEventListener("message", onServiceWorkerMessage);
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((nextRegistration) => {
        if (!active) return;
        registration = nextRegistration;
        registration.addEventListener("updatefound", onUpdateFound);
        onUpdateFound();
        observeWaitingWorker();
        void registration
          .update()
          .then(observeWaitingWorker)
          .catch(() => {
            // A later navigation will check again; offline access remains optional.
          });
      })
      .catch(() => {
        // Offline access remains optional; unlock with the online application still works.
      });

    return () => {
      active = false;
      clearApplyTimeout();
      installingWorker?.removeEventListener("statechange", onInstallingStateChange);
      registration?.removeEventListener("updatefound", onUpdateFound);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      navigator.serviceWorker.removeEventListener("message", onServiceWorkerMessage);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToLocalVaultLock(() => {
      setDeferred(false);
      setApplyFailed(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (previousPathnameRef.current === pathname) return;
    previousPathnameRef.current = pathname;
    setDeferred(false);
  }, [pathname]);

  function applyUpdate() {
    const worker = waitingWorkerRef.current;
    if (!worker || applying) return;
    setApplying(true);
    shouldReloadRef.current = true;
    beginPwaUpdateLock();

    const channel = new MessageChannel();
    channel.port1.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if (event.data?.type === updateActivatingMessage) {
        channel.port1.close();
        return;
      }
      if (event.data?.type !== updateBlockedMessage) return;
      cancelPwaUpdateLock();
      shouldReloadRef.current = false;
      setApplying(false);
      setApplyFailed(true);
      if (applyTimeoutRef.current !== null) {
        window.clearTimeout(applyTimeoutRef.current);
        applyTimeoutRef.current = null;
      }
      channel.port1.close();
    };
    channel.port1.start();
    applyTimeoutRef.current = window.setTimeout(() => {
      applyTimeoutRef.current = null;
      channel.port1.close();
      window.location.reload();
    }, 60_000);

    try {
      worker.postMessage({ type: applyUpdateMessage, locale }, [channel.port2]);
    } catch {
      cancelPwaUpdateLock();
      shouldReloadRef.current = false;
      setApplying(false);
      setApplyFailed(true);
      if (applyTimeoutRef.current !== null) {
        window.clearTimeout(applyTimeoutRef.current);
        applyTimeoutRef.current = null;
      }
      channel.port1.close();
    }
  }

  if (!waitingWorker || deferred) return null;

  return (
    <aside className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 px-3 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <StatusBanner tone={applyFailed ? "warning" : "info"} role="status" title={t("title")}>
          <p>{applying ? t("applyingDescription") : t("description")}</p>
          {applyFailed && (
            <p role="alert" className="mt-2 font-semibold">
              {t("applyFailed")}
            </p>
          )}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={applying} onClick={() => setDeferred(true)}>
              {t("later")}
            </Button>
            <Button type="button" disabled={applying} aria-busy={applying} onClick={applyUpdate}>
              {applying ? t("applying") : t("applyNow")}
            </Button>
          </div>
        </StatusBanner>
      </div>
    </aside>
  );
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
