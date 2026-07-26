"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const MINIMUM_VISIBLE_MS = 350;
const NAVIGATION_TIMEOUT_MS = 10_000;

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const route = `${pathname}?${searchParams.toString()}`;
  const previousRoute = useRef(route);
  const startedAt = useRef<number | null>(null);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function start(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;

      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.protocol !== window.location.protocol) return;
      if (`${destination.pathname}${destination.search}` === `${window.location.pathname}${window.location.search}`) return;

      if (finishTimer.current) clearTimeout(finishTimer.current);
      if (timeoutTimer.current) clearTimeout(timeoutTimer.current);
      startedAt.current = Date.now();
      setVisible(true);
      timeoutTimer.current = setTimeout(() => {
        startedAt.current = null;
        setVisible(false);
      }, NAVIGATION_TIMEOUT_MS);
    }

    document.addEventListener("click", start);
    return () => document.removeEventListener("click", start);
  }, []);

  useEffect(() => {
    if (previousRoute.current === route) return;
    previousRoute.current = route;
    if (startedAt.current === null) return;

    const remaining = Math.max(0, MINIMUM_VISIBLE_MS - (Date.now() - startedAt.current));
    finishTimer.current = setTimeout(() => {
      if (timeoutTimer.current) clearTimeout(timeoutTimer.current);
      startedAt.current = null;
      setVisible(false);
    }, remaining);
  }, [route]);

  useEffect(() => () => {
    if (finishTimer.current) clearTimeout(finishTimer.current);
    if (timeoutTimer.current) clearTimeout(timeoutTimer.current);
  }, []);

  return visible ? <PageProgressBar /> : null;
}

export function PageProgressBar() {
  return (
    <div
      className="fixed inset-x-0 top-0 z-50 h-1 overflow-hidden bg-gold-soft"
      role="progressbar"
      aria-label="Membuka halaman"
      aria-valuetext="Sedang memuat"
    >
      <span className="block h-full w-1/3 animate-page-progress bg-primary" />
    </div>
  );
}
