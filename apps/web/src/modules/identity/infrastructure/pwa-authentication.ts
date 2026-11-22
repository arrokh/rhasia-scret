"use client";

import { DEFAULT_AUTH_RETURN_PATH, INVITATION_AUTH_RETURN_PATH } from "../application/auth-return-path";
import {
  isSafePwaHandoffId,
  isSafePwaHandoffVerifier,
  type PasswordlessReturnPath,
} from "../application/passwordless-client-contract";

const PWA_AUTH_HANDOFF_STORAGE_KEY = "rhasia-scret:pwa-auth-handoff";
const PWA_AUTH_PROVISIONAL_HANDOFF_STORAGE_KEY = "rhasia-scret:pwa-auth-handoff:provisional";
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
  returnPath: PasswordlessReturnPath;
}>;

export type PendingPwaAuthenticationHandoff = Readonly<{
  handoffId: string;
  verifier: string;
}>;

export type ProvisionalPwaAuthenticationHandoff = Readonly<{
  handoff: PendingPwaAuthenticationHandoff;
  expiresAt: number;
}>;

export function isPwaDisplayMode(): boolean {
  if (typeof window === "undefined") return false;
  const standaloneNavigator = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standaloneNavigator || window.matchMedia?.("(display-mode: standalone)")?.matches === true;
}

export function readPwaAuthenticationHandoff(): PendingPwaAuthenticationHandoff | null {
  const active = readStoredPwaAuthenticationHandoff(PWA_AUTH_HANDOFF_STORAGE_KEY);
  if (!active) return null;
  if (active.expiresAt !== null && active.expiresAt <= Date.now()) {
    clearPwaAuthenticationHandoff(active.handoff.handoffId);
    return null;
  }
  return active.handoff;
}

export function readPwaAuthenticationHandoffById(handoffId: string): PendingPwaAuthenticationHandoff | null {
  if (!isSafePwaHandoffId(handoffId)) return null;
  const active = readStoredPwaAuthenticationHandoff(PWA_AUTH_HANDOFF_STORAGE_KEY);
  if (active?.handoff.handoffId === handoffId) {
    if (active.expiresAt !== null && active.expiresAt <= Date.now()) {
      clearPwaAuthenticationHandoff(handoffId);
      return null;
    }
    return active.handoff;
  }
  const provisional = readProvisionalPwaAuthenticationHandoff();
  return provisional?.handoff.handoffId === handoffId ? provisional.handoff : null;
}

export function readProvisionalPwaAuthenticationHandoff(): ProvisionalPwaAuthenticationHandoff | null {
  const provisional = readStoredPwaAuthenticationHandoff(PWA_AUTH_PROVISIONAL_HANDOFF_STORAGE_KEY);
  if (!provisional) return null;
  if (provisional.expiresAt === null || provisional.expiresAt <= Date.now()) {
    clearPwaAuthenticationProvisionalHandoff(provisional.handoff.handoffId);
    return null;
  }
  return { handoff: provisional.handoff, expiresAt: provisional.expiresAt };
}

export function readPwaAuthenticationHandoffExpiresAt(handoffId: string): number | null {
  const active = readStoredPwaAuthenticationHandoff(PWA_AUTH_HANDOFF_STORAGE_KEY);
  if (active?.handoff.handoffId === handoffId) return active.expiresAt;
  const provisional = readProvisionalPwaAuthenticationHandoff();
  return provisional?.handoff.handoffId === handoffId ? provisional.expiresAt : null;
}

export function storePwaAuthenticationHandoff(handoff: PendingPwaAuthenticationHandoff, expiresAt: number): boolean {
  if (!isValidStoredHandoff(handoff, expiresAt)) return false;
  try {
    window.sessionStorage.setItem(PWA_AUTH_HANDOFF_STORAGE_KEY, JSON.stringify({ ...handoff, expiresAt }));
    clearPwaAuthenticationProvisionalHandoff(handoff.handoffId);
    return true;
  } catch {
    // The handoff remains usable while the PWA page stays open; keep any provisional record on storage failure.
    return false;
  }
}

export function storeProvisionalPwaAuthenticationHandoff(
  handoff: PendingPwaAuthenticationHandoff,
  expiresAt: number,
): boolean {
  if (!isValidStoredHandoff(handoff, expiresAt)) return false;
  try {
    window.sessionStorage.setItem(PWA_AUTH_PROVISIONAL_HANDOFF_STORAGE_KEY, JSON.stringify({ ...handoff, expiresAt }));
    return true;
  } catch {
    // The sign-in window keeps the provisional verifier in memory when session storage is blocked.
    return false;
  }
}

export function subscribeToPwaAuthenticationVerifierRequests(
  getVerifier: (handoffId: string) => string | null,
): () => void {
  const channel = createPwaAuthenticationChannel();
  if (!channel) return () => undefined;
  const onMessage = (event: MessageEvent<unknown>) => {
    if (!isPwaHandoffVerifierRequest(event.data)) return;
    try {
      const verifier = getVerifier(event.data.handoffId);
      if (!verifier || !isSafePwaHandoffVerifier(verifier)) return;
      channel.postMessage({
        type: PWA_HANDOFF_VERIFIER_RESPONSE,
        requestId: event.data.requestId,
        handoffId: event.data.handoffId,
        verifier,
      } satisfies PwaHandoffVerifierResponse);
    } catch {
      // A blocked channel or storage read cannot expose the verifier or break sign-in.
    }
  };
  try {
    channel.addEventListener("message", onMessage);
  } catch {
    closePwaAuthenticationChannel(channel);
    return () => undefined;
  }
  return () => {
    try {
      channel.removeEventListener("message", onMessage);
    } catch {
      // Closing the channel still releases its listener.
    }
    closePwaAuthenticationChannel(channel);
  };
}

export function announcePwaAuthenticationCompletion(handoffId: string, returnPath: PasswordlessReturnPath): void {
  if (!isSafePwaHandoffId(handoffId) || !isPasswordlessReturnPath(returnPath)) return;
  const channel = createPwaAuthenticationChannel();
  if (!channel) return;
  try {
    channel.postMessage({ type: PWA_HANDOFF_COMPLETED, handoffId, returnPath } satisfies PwaHandoffCompleted);
  } catch {
    // Completion announcements are best effort after the server has accepted the handoff.
  }
  closePwaAuthenticationChannel(channel);
}

export function subscribeToPwaAuthenticationCompletion(
  onComplete: (handoffId: string, returnPath: PasswordlessReturnPath) => void,
): () => void {
  const channel = createPwaAuthenticationChannel();
  if (!channel) return () => undefined;
  const onMessage = (event: MessageEvent<unknown>) => {
    if (isPwaHandoffCompleted(event.data)) onComplete(event.data.handoffId, event.data.returnPath);
  };
  try {
    channel.addEventListener("message", onMessage);
  } catch {
    closePwaAuthenticationChannel(channel);
    return () => undefined;
  }
  return () => {
    try {
      channel.removeEventListener("message", onMessage);
    } catch {
      // Closing the channel still releases its listener.
    }
    closePwaAuthenticationChannel(channel);
  };
}

export function requestPwaAuthenticationVerifier(handoffId: string): Promise<string | null> {
  if (!isSafePwaHandoffId(handoffId)) return Promise.resolve(null);
  const channel = createPwaAuthenticationChannel();
  if (!channel) return Promise.resolve(null);
  const activeChannel: BroadcastChannel = channel;
  const requestId = window.crypto.randomUUID();
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
      try {
        activeChannel.removeEventListener("message", onMessage);
      } catch {
        // Closing the channel still releases its listener.
      }
      closePwaAuthenticationChannel(activeChannel);
      resolve(verifier);
    }
    try {
      activeChannel.addEventListener("message", onMessage);
      activeChannel.postMessage({
        type: PWA_HANDOFF_VERIFIER_REQUEST,
        requestId,
        handoffId,
      } satisfies PwaHandoffVerifierRequest);
    } catch {
      finish(null);
    }
  });
}

export function createPwaAuthenticationHandoff(): PendingPwaAuthenticationHandoff {
  const handoffId = window.crypto.randomUUID();
  const verifier = encodeVerifier(window.crypto.getRandomValues(new Uint8Array(32)));
  if (!isSafePwaHandoffId(handoffId) || !isSafePwaHandoffVerifier(verifier))
    throw new Error("PWA authentication handoff is invalid.");
  return { handoffId, verifier } satisfies PendingPwaAuthenticationHandoff;
}

export function clearPwaAuthenticationHandoff(expectedHandoffId?: string): void {
  if (expectedHandoffId !== undefined && !isSafePwaHandoffId(expectedHandoffId)) return;
  clearStoredPwaAuthenticationHandoff(PWA_AUTH_HANDOFF_STORAGE_KEY, expectedHandoffId);
  clearStoredPwaAuthenticationHandoff(PWA_AUTH_PROVISIONAL_HANDOFF_STORAGE_KEY, expectedHandoffId);
}

export function clearPwaAuthenticationProvisionalHandoff(expectedHandoffId: string): void {
  if (!isSafePwaHandoffId(expectedHandoffId)) return;
  clearStoredPwaAuthenticationHandoff(PWA_AUTH_PROVISIONAL_HANDOFF_STORAGE_KEY, expectedHandoffId);
}

function clearStoredPwaAuthenticationHandoff(storageKey: string, expectedHandoffId?: string): void {
  try {
    if (
      expectedHandoffId !== undefined &&
      readStoredPwaAuthenticationHandoff(storageKey)?.handoff.handoffId !== expectedHandoffId
    )
      return;
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // Storage cleanup is best effort; the verifier is short-lived and client-only.
  }
}

function isValidStoredHandoff(handoff: PendingPwaAuthenticationHandoff, expiresAt: number): boolean {
  return (
    isSafePwaHandoffId(handoff.handoffId) &&
    isSafePwaHandoffVerifier(handoff.verifier) &&
    Number.isSafeInteger(expiresAt) &&
    expiresAt > 0
  );
}

function readStoredPwaAuthenticationHandoff(storageKey: string): Readonly<{
  handoff: PendingPwaAuthenticationHandoff;
  expiresAt: number | null;
}> | null {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null");
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<PendingPwaAuthenticationHandoff> & { expiresAt?: unknown };
    const handoffId = candidate.handoffId;
    const verifier = candidate.verifier;
    if (
      typeof handoffId !== "string" ||
      typeof verifier !== "string" ||
      !isSafePwaHandoffId(handoffId) ||
      !isSafePwaHandoffVerifier(verifier)
    )
      return null;
    const expiresAt =
      Number.isSafeInteger(candidate.expiresAt) && Number(candidate.expiresAt) > 0 ? Number(candidate.expiresAt) : null;
    return { handoff: { handoffId, verifier }, expiresAt };
  } catch {
    return null;
  }
}

function createPwaAuthenticationChannel(): BroadcastChannel | undefined {
  if (typeof BroadcastChannel === "undefined") return undefined;
  try {
    return new BroadcastChannel(PWA_AUTH_HANDOFF_CHANNEL_NAME);
  } catch {
    return undefined;
  }
}

function closePwaAuthenticationChannel(channel: BroadcastChannel): void {
  try {
    channel.close();
  } catch {
    // A platform cleanup failure must not turn a completed authentication into an error.
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
    isSafePwaHandoffId(candidate.handoffId) &&
    isPasswordlessReturnPath(candidate.returnPath)
  );
}

function isPasswordlessReturnPath(value: unknown): value is PasswordlessReturnPath {
  return value === DEFAULT_AUTH_RETURN_PATH || value === INVITATION_AUTH_RETURN_PATH;
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
