import { SECURE_SHARE_LINK_MEMORY_MAX_AGE_MS } from "./browser-secure-share-link-secret-state";

type PendingAuthentication = { secret: string; completionHandled: boolean; expiresAt: number };

let pendingAuthentication: PendingAuthentication | undefined;
let clearTimer: number | undefined;
let expiryTimer: number | undefined;

export function beginSecureShareLinkAuthentication(secret: string): void {
  cancelClearTimer();
  expirePendingSecret();
  if (secret) {
    replacePending(secret);
    return;
  }
  pendingAuthentication ??= {
    secret: "",
    completionHandled: false,
    expiresAt: Date.now() + SECURE_SHARE_LINK_MEMORY_MAX_AGE_MS,
  };
}

export function replacePendingSecureShareLinkSecret(secret: string): void {
  if (!secret) return;
  cancelClearTimer();
  replacePending(secret);
}

export function consumeSecureShareLinkAuthenticationCompletion(): string | null {
  if (!pendingAuthentication || pendingAuthentication.completionHandled) return null;
  const expired = pendingAuthentication.expiresAt <= Date.now();
  const secret = expired ? "" : pendingAuthentication.secret;
  pendingAuthentication.completionHandled = true;
  pendingAuthentication.secret = "";
  cancelExpiryTimer();
  return secret;
}

export function clearPendingSecureShareLinkAuthentication(): void {
  cancelClearTimer();
  cancelExpiryTimer();
  pendingAuthentication = undefined;
}

export function scheduleSecureShareLinkAuthenticationClear(): void {
  cancelClearTimer();
  if (typeof window === "undefined") {
    clearPendingSecureShareLinkAuthentication();
    return;
  }
  clearTimer = window.setTimeout(() => {
    pendingAuthentication = undefined;
    clearTimer = undefined;
    cancelExpiryTimer();
  }, 0);
}

export function retainSecureShareLinkAuthentication(): void {
  cancelClearTimer();
  expirePendingSecret();
}

function replacePending(secret: string): void {
  cancelExpiryTimer();
  const pending = {
    secret,
    completionHandled: false,
    expiresAt: Date.now() + SECURE_SHARE_LINK_MEMORY_MAX_AGE_MS,
  };
  pendingAuthentication = pending;
  if (typeof window === "undefined") return;
  expiryTimer = window.setTimeout(() => {
    if (pendingAuthentication === pending) pending.secret = "";
    expiryTimer = undefined;
  }, SECURE_SHARE_LINK_MEMORY_MAX_AGE_MS);
}

function expirePendingSecret(): void {
  if (!pendingAuthentication || pendingAuthentication.expiresAt > Date.now()) return;
  pendingAuthentication.secret = "";
  cancelExpiryTimer();
}

function cancelClearTimer(): void {
  if (clearTimer === undefined || typeof window === "undefined") return;
  window.clearTimeout(clearTimer);
  clearTimer = undefined;
}

function cancelExpiryTimer(): void {
  if (expiryTimer === undefined || typeof window === "undefined") return;
  window.clearTimeout(expiryTimer);
  expiryTimer = undefined;
}
