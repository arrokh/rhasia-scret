"use client";

import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let currentTime = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let listeningForVisibility = false;

function emitCurrentTime(): void {
  currentTime = Date.now();
  for (const listener of listeners) listener();
}

function scheduleNextTick(): void {
  if (timer || typeof document === "undefined" || document.visibilityState === "hidden" || listeners.size === 0) return;
  const delay = Math.max(1, 1_000 - (Date.now() % 1_000));
  timer = setTimeout(() => {
    timer = null;
    emitCurrentTime();
    scheduleNextTick();
  }, delay);
}

function handleVisibilityChange(): void {
  if (document.visibilityState === "hidden") {
    if (timer) clearTimeout(timer);
    timer = null;
    return;
  }
  emitCurrentTime();
  scheduleNextTick();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    currentTime = Date.now();
    if (!listeningForVisibility) {
      document.addEventListener("visibilitychange", handleVisibilityChange);
      listeningForVisibility = true;
    }
    scheduleNextTick();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    if (timer) clearTimeout(timer);
    timer = null;
    currentTime = 0;
    if (listeningForVisibility) {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      listeningForVisibility = false;
    }
  };
}

function getSnapshot(): number {
  return currentTime;
}

function getServerSnapshot(): number {
  return 0;
}

export function useTotpClock(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
