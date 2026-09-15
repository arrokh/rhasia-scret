"use client";

import { isSafePwaHandoffId, isSafePwaHandoffVerifier } from "../application/passwordless-authentication";

const PWA_AUTH_HANDOFF_STORAGE_KEY = "rhasia-scret:pwa-auth-handoff";

export type PendingPwaAuthenticationHandoff = Readonly<{
  handoffId: string;
  verifier: string;
}>;

export function isPwaDisplayMode(): boolean {
  if (typeof window === "undefined") return false;
  const standaloneNavigator = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standaloneNavigator || window.matchMedia?.("(display-mode: standalone)")?.matches === true;
}

export function readPwaAuthenticationHandoff(): PendingPwaAuthenticationHandoff | null {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(PWA_AUTH_HANDOFF_STORAGE_KEY) ?? "null");
    if (!value || typeof value !== "object") return null;
    const handoff = value as Partial<PendingPwaAuthenticationHandoff>;
    const handoffId = handoff.handoffId;
    const verifier = handoff.verifier;
    return typeof handoffId === "string" &&
      typeof verifier === "string" &&
      isSafePwaHandoffId(handoffId) &&
      isSafePwaHandoffVerifier(verifier)
      ? { handoffId, verifier }
      : null;
  } catch {
    return null;
  }
}

export function createPwaAuthenticationHandoff(): PendingPwaAuthenticationHandoff {
  const handoffId = window.crypto.randomUUID();
  const verifier = encodeVerifier(window.crypto.getRandomValues(new Uint8Array(32)));
  if (!isSafePwaHandoffId(handoffId) || !isSafePwaHandoffVerifier(verifier))
    throw new Error("PWA authentication handoff is invalid.");
  const handoff = { handoffId, verifier } satisfies PendingPwaAuthenticationHandoff;
  try {
    window.sessionStorage.setItem(PWA_AUTH_HANDOFF_STORAGE_KEY, JSON.stringify(handoff));
  } catch {
    // The handoff remains usable while the PWA page stays open.
  }
  return handoff;
}

export function clearPwaAuthenticationHandoff(): void {
  try {
    window.sessionStorage.removeItem(PWA_AUTH_HANDOFF_STORAGE_KEY);
  } catch {
    // Storage cleanup is best effort; the verifier is short-lived and client-only.
  }
}

function encodeVerifier(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
