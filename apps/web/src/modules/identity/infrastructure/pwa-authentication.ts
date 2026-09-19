"use client";

import { isSafePwaHandoffId, isSafePwaHandoffVerifier } from "../application/passwordless-client-contract";

const PWA_AUTH_HANDOFF_STORAGE_KEY = "rhasia-scret:pwa-auth-handoff";
const PWA_AUTH_HANDOFF_CHANNEL_NAME = "rhasia-scret:pwa-authentication-handoff";
const PWA_HANDOFF_VERIFIER_REQUEST = "request-verifier";
const PWA_HANDOFF_VERIFIER_RESPONSE = "verifier";
const PWA_HANDOFF_COMPLETED = "completed";
const PWA_HANDOFF_VERIFIER_REQUEST_TIMEOUT_MS = 5_000;

type PwaHandoffVerifierRequest = Readonly<{
  type: typeof PWA_HANDOFF_VERIFIER_REQUEST;
  requestId: string;
  handoffId: string;
}>;

type PwaHandoffVerifierResponse = Readonly<{
  type: typeof PWA_HANDOFF_VERIFIER_RESPONSE;
  requestId: string;
  handoffId: string;
  verifier: string;
}>;

type PwaHandoffCompleted = Readonly<{
  type: typeof PWA_HANDOFF_COMPLETED;
  handoffId: string;
}>;

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

export function subscribeToPwaAuthenticationVerifierRequests(
  getVerifier: (handoffId: string) => string | null,
): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(PWA_AUTH_HANDOFF_CHANNEL_NAME);
  const onMessage = (event: MessageEvent<unknown>) => {
    if (!isPwaHandoffVerifierRequest(event.data)) return;
    const verifier = getVerifier(event.data.handoffId);
    if (!verifier || !isSafePwaHandoffVerifier(verifier)) return;
    channel.postMessage({
      type: PWA_HANDOFF_VERIFIER_RESPONSE,
      requestId: event.data.requestId,
      handoffId: event.data.handoffId,
      verifier,
    } satisfies PwaHandoffVerifierResponse);
  };
  channel.addEventListener("message", onMessage);
  return () => {
    channel.removeEventListener("message", onMessage);
    channel.close();
  };
}

export function announcePwaAuthenticationCompletion(handoffId: string): void {
  if (typeof BroadcastChannel === "undefined" || !isSafePwaHandoffId(handoffId)) return;
  const channel = new BroadcastChannel(PWA_AUTH_HANDOFF_CHANNEL_NAME);
  channel.postMessage({ type: PWA_HANDOFF_COMPLETED, handoffId } satisfies PwaHandoffCompleted);
  channel.close();
}

export function subscribeToPwaAuthenticationCompletion(onComplete: (handoffId: string) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(PWA_AUTH_HANDOFF_CHANNEL_NAME);
  const onMessage = (event: MessageEvent<unknown>) => {
    if (isPwaHandoffCompleted(event.data)) onComplete(event.data.handoffId);
  };
  channel.addEventListener("message", onMessage);
  return () => {
    channel.removeEventListener("message", onMessage);
    channel.close();
  };
}

export function requestPwaAuthenticationVerifier(handoffId: string): Promise<string | null> {
  if (typeof BroadcastChannel === "undefined" || !isSafePwaHandoffId(handoffId)) return Promise.resolve(null);
  const requestId = window.crypto.randomUUID();
  const channel = new BroadcastChannel(PWA_AUTH_HANDOFF_CHANNEL_NAME);
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => finish(null), PWA_HANDOFF_VERIFIER_REQUEST_TIMEOUT_MS);
    const onMessage = (event: MessageEvent<unknown>) => {
      if (
        isPwaHandoffVerifierResponse(event.data) &&
        event.data.requestId === requestId &&
        event.data.handoffId === handoffId
      )
        finish(event.data.verifier);
    };
    function finish(verifier: string | null): void {
      window.clearTimeout(timeout);
      channel.removeEventListener("message", onMessage);
      channel.close();
      resolve(verifier);
    }
    channel.addEventListener("message", onMessage);
    channel.postMessage({
      type: PWA_HANDOFF_VERIFIER_REQUEST,
      requestId,
      handoffId,
    } satisfies PwaHandoffVerifierRequest);
  });
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

function isPwaHandoffVerifierRequest(value: unknown): value is PwaHandoffVerifierRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PwaHandoffVerifierRequest>;
  return (
    candidate.type === PWA_HANDOFF_VERIFIER_REQUEST &&
    typeof candidate.requestId === "string" &&
    typeof candidate.handoffId === "string" &&
    isSafePwaHandoffId(candidate.handoffId)
  );
}

function isPwaHandoffCompleted(value: unknown): value is PwaHandoffCompleted {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PwaHandoffCompleted>;
  return (
    candidate.type === PWA_HANDOFF_COMPLETED &&
    typeof candidate.handoffId === "string" &&
    isSafePwaHandoffId(candidate.handoffId)
  );
}

function isPwaHandoffVerifierResponse(value: unknown): value is PwaHandoffVerifierResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PwaHandoffVerifierResponse>;
  return (
    candidate.type === PWA_HANDOFF_VERIFIER_RESPONSE &&
    typeof candidate.requestId === "string" &&
    typeof candidate.handoffId === "string" &&
    isSafePwaHandoffId(candidate.handoffId) &&
    typeof candidate.verifier === "string" &&
    isSafePwaHandoffVerifier(candidate.verifier)
  );
}

function encodeVerifier(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
