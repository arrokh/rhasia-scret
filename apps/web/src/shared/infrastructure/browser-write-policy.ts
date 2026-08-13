"use client";

let readOnlyReason: string | null = null;

export class OfflineMutationError extends Error {
  constructor(message = "Changes are unavailable while the Vault workspace is offline or stale.") {
    super(message);
    this.name = "OfflineMutationError";
  }
}

export function setBrowserWritesReadOnly(reason: string | null): void {
  readOnlyReason = reason;
}

export function browserWritesAreReadOnly(): boolean {
  return readOnlyReason !== null || (typeof navigator !== "undefined" && navigator.onLine === false);
}

export function assertBrowserMutationAllowed(): void {
  if (browserWritesAreReadOnly()) throw new OfflineMutationError(readOnlyReason ?? undefined);
}
