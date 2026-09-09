/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ argon2id: vi.fn(async () => new Uint8Array(32).fill(7)) }));
vi.mock("hash-wasm", () => ({ argon2id: mocks.argon2id }));

import { deriveVaultUnlockKey } from "@/modules/crypto/infrastructure/browser-vault-unlock-key";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Vault Unlock Key derivation", () => {
  it("preserves the production Argon2id parameters in the non-Worker fallback", async () => {
    vi.stubGlobal("Worker", undefined);
    const salt = new Uint8Array(16).fill(3);

    await expect(deriveVaultUnlockKey("three secret words", salt)).resolves.toEqual(new Uint8Array(32).fill(7));
    expect(mocks.argon2id).toHaveBeenCalledWith({
      password: "three secret words",
      salt,
      parallelism: 1,
      iterations: 3,
      memorySize: 64 * 1024,
      hashLength: 32,
      outputType: "binary",
    });
  });

  it("falls back to the unchanged inline derivation when the module Worker cannot load", async () => {
    const workerState = { terminated: false };
    class FailingWorker {
      onmessage: ((event: MessageEvent<{ ok: true; key: ArrayBuffer }>) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage() {
        queueMicrotask(() => this.onerror?.());
      }
      terminate() {
        workerState.terminated = true;
      }
    }
    vi.stubGlobal("Worker", FailingWorker);
    const salt = new Uint8Array(16).fill(5);

    await expect(deriveVaultUnlockKey("three secret words", salt)).resolves.toEqual(new Uint8Array(32).fill(7));

    expect(mocks.argon2id).toHaveBeenCalledWith(
      expect.objectContaining({ iterations: 3, memorySize: 64 * 1024, parallelism: 1 }),
    );
    expect(workerState.terminated).toBe(true);
  });

  it("uses a short-lived module Worker and transfers only copied derivation bytes", async () => {
    const workerState: { url?: URL; options?: WorkerOptions; terminated: boolean; transfers: number } = {
      terminated: false,
      transfers: 0,
    };
    class FakeWorker {
      onmessage: ((event: MessageEvent<{ ok: true; key: ArrayBuffer }>) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url: URL, options: WorkerOptions) {
        workerState.url = url;
        workerState.options = options;
      }
      postMessage(_: { password: ArrayBuffer; salt: ArrayBuffer }, transfer: Transferable[]) {
        workerState.transfers = transfer.length;
        queueMicrotask(() =>
          this.onmessage?.(new MessageEvent("message", { data: { ok: true, key: new Uint8Array(32).fill(9).buffer } })),
        );
      }
      terminate() {
        workerState.terminated = true;
      }
    }
    vi.stubGlobal("Worker", FakeWorker);
    const salt = new Uint8Array(16).fill(4);

    await expect(deriveVaultUnlockKey("three secret words", salt)).resolves.toEqual(new Uint8Array(32).fill(9));

    expect(workerState.url?.pathname).toContain("browser-vault-unlock-key-worker.ts");
    expect(workerState.options).toEqual({ type: "module" });
    expect(workerState.transfers).toBe(2);
    expect(workerState.terminated).toBe(true);
    expect(salt).toEqual(new Uint8Array(16).fill(4));
    expect(mocks.argon2id).not.toHaveBeenCalled();
  });
});
