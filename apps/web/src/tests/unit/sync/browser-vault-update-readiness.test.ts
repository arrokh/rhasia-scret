// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  beginPwaUpdateLock,
  cancelPwaUpdateLock,
  pendingVaultSensitiveOperations,
  trackVaultSensitiveOperation,
} from "@/modules/sync/infrastructure/browser-vault-lock";
import { waitForPendingVaultSensitiveOperations } from "@/modules/sync/infrastructure/browser-vault-update-readiness";

afterEach(() => cancelPwaUpdateLock());

describe("PWA update sensitive-work readiness", () => {
  it("waits for tracked work and clears its stale result after locking", async () => {
    let resolveOperation: ((result: Uint8Array) => void) | undefined;
    let staleResult: Uint8Array | undefined;
    const operation = trackVaultSensitiveOperation(
      () =>
        new Promise<Uint8Array>((resolve) => {
          resolveOperation = resolve;
        }),
      (result) => {
        staleResult = result;
        result.fill(0);
      },
    );
    const expectOperationToReject = expect(operation).rejects.toThrow();
    const readiness = waitForPendingVaultSensitiveOperations();
    let ready = false;
    void readiness.then(() => {
      ready = true;
    });

    beginPwaUpdateLock();
    await Promise.resolve();
    expect(ready).toBe(false);
    expect(pendingVaultSensitiveOperations.size).toBe(1);

    resolveOperation?.(new Uint8Array([7, 8, 9]));
    await expectOperationToReject;
    await readiness;

    expect(ready).toBe(true);
    expect(staleResult && [...staleResult]).toEqual([0, 0, 0]);
    expect(pendingVaultSensitiveOperations.size).toBe(0);
    await expect(trackVaultSensitiveOperation(async () => undefined)).rejects.toThrow();
  });
});
