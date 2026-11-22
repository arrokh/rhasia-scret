export const SECURE_SHARE_LINK_MEMORY_MAX_AGE_MS = 60 * 60 * 1000;
let secureShareLinkSecret = "";
let secretScope = "";
let secretExpiresAt = 0;
let clearTimer: number | undefined;

export function readSecureShareLinkSecret(scope: string): string {
  return secretScope === scope && secretExpiresAt > Date.now() ? secureShareLinkSecret : "";
}

export function getSecureShareLinkSecretRemainingLifetime(scope: string): number | undefined {
  if (!readSecureShareLinkSecret(scope)) return undefined;
  return secretExpiresAt - Date.now();
}

export function retainSecureShareLinkSecret(scope: string): void {
  setScope(scope);
  cancelClearTimer();
  if (secretExpiresAt <= Date.now()) clearSecureShareLinkSecret(scope);
}

export function replaceSecureShareLinkSecret(scope: string, secret: string): void {
  if (!secret) return;
  setScope(scope);
  cancelClearTimer();
  secureShareLinkSecret = secret;
  secretExpiresAt = Date.now() + SECURE_SHARE_LINK_MEMORY_MAX_AGE_MS;
}

export function clearSecureShareLinkSecret(scope: string, expectedSecret?: string): boolean {
  if (secretScope !== scope) return false;
  if (expectedSecret !== undefined && secureShareLinkSecret !== expectedSecret) return false;
  cancelClearTimer();
  secureShareLinkSecret = "";
  secretExpiresAt = 0;
  return true;
}

export function scheduleSecureShareLinkSecretClear(scope: string): void {
  cancelClearTimer();
  if (typeof window === "undefined") {
    if (secretScope === scope) clearSecureShareLinkSecret(scope);
    return;
  }
  clearTimer = window.setTimeout(() => {
    if (secretScope === scope) clearSecureShareLinkSecret(scope);
    clearTimer = undefined;
  }, 0);
}

function setScope(scope: string): void {
  if (secretScope === scope) return;
  cancelClearTimer();
  secureShareLinkSecret = "";
  secretExpiresAt = 0;
  secretScope = scope;
}

function cancelClearTimer(): void {
  if (clearTimer === undefined || typeof window === "undefined") return;
  window.clearTimeout(clearTimer);
  clearTimer = undefined;
}
