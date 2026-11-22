/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkspaceLifecycle,
  type WorkspaceLifecyclePorts,
  type WorkspaceLifecycleValue,
} from "@rhasia-scret/client-vault-core";
import { subscribeToBrowserAuthenticationSessionChange } from "@/shared/infrastructure/browser-authentication-session-change";

type BrowserVaultLockModule = typeof import("@/modules/sync/infrastructure/browser-vault-lock");

type TestWorkspace = WorkspaceLifecycleValue & {
  personalVaultKey: Uint8Array;
  accountSecret: Uint8Array;
};

type Listener = (event: MessageEvent<unknown>) => void;
const channels = new Set<FakeBroadcastChannel>();
let browserVaultLock: BrowserVaultLockModule;
let testWindows: Array<Window & typeof globalThis> = [];

class TestStorageEvent extends Event {
  public readonly key: string | null;
  public readonly oldValue: string | null;
  public readonly newValue: string | null;
  public readonly url: string;

  public constructor(type: string, init: StorageEventInit = {}) {
    super(type);
    this.key = init.key ?? null;
    this.oldValue = init.oldValue ?? null;
    this.newValue = init.newValue ?? null;
    this.url = init.url ?? "";
  }
}

function createTestWindow(): Window & typeof globalThis {
  const testWindow = new EventTarget() as unknown as Window & typeof globalThis;
  Object.defineProperties(testWindow, {
    Event: { value: Event },
    StorageEvent: { value: TestStorageEvent },
    location: { value: { href: "http://localhost:4000" } },
    localStorage: { configurable: true, writable: true, value: {} },
    close: { value: () => undefined },
  });
  testWindows.push(testWindow);
  return testWindow;
}

function setWindowContext(testWindow: Window & typeof globalThis): void {
  vi.stubGlobal("window", testWindow);
  vi.stubGlobal("Event", testWindow.Event);
}

class FakeBroadcastChannel {
  private readonly listeners = new Set<Listener>();

  public constructor(private readonly name: string) {
    channels.add(this);
  }

  public addEventListener(type: string, listener: Listener): void {
    if (type === "message") this.listeners.add(listener);
  }

  public removeEventListener(type: string, listener: Listener): void {
    if (type === "message") this.listeners.delete(listener);
  }

  public postMessage(data: unknown): void {
    for (const channel of channels) {
      if (channel === this || channel.name !== this.name) continue;
      for (const listener of channel.listeners) listener(new MessageEvent("message", { data }));
    }
  }

  public close(): void {
    channels.delete(this);
  }
}

describe("cross-tab Vault session lock", () => {
  beforeEach(async () => {
    vi.resetModules();
    browserVaultLock = await import("@/modules/sync/infrastructure/browser-vault-lock");
  });

  afterEach(() => {
    for (const testWindow of testWindows) testWindow.close();
    testWindows = [];
    channels.clear();
    vi.unstubAllGlobals();
  });

  it("clears the complete unlocked workspace on a cross-tab session-change message", () => {
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const workspace: TestWorkspace = {
      profileId: "synthetic-profile",
      syncState: "CURRENT",
      userRootKey: Uint8Array.of(1, 2),
      personalVaultKey: Uint8Array.of(3, 4),
      accountSecret: Uint8Array.of(5, 6),
    };
    const ports: WorkspaceLifecyclePorts<TestWorkspace> = {
      network: { isOnline: () => false, subscribe: () => () => undefined },
      applicationLifecycle: { isVisible: () => false, subscribeVisibility: () => () => undefined },
      lock: browserVaultLock.browserVaultLockPort,
      writes: { setReadOnly: () => undefined },
      workspace: {
        refresh: async () => {
          throw new Error("unexpected refresh");
        },
        clear: (value) => {
          value?.userRootKey.fill(0);
          value?.personalVaultKey.fill(0);
          value?.accountSecret.fill(0);
        },
        classifyFailure: () => "SYNC",
        readOnlyReason: () => "synthetic workspace",
      },
    };
    const lifecycle = new WorkspaceLifecycle(workspace, ports);
    lifecycle.start();
    const received: unknown[] = [];
    const sessionChanges: string[] = [];
    const unsubscribeSessionChanges = subscribeToBrowserAuthenticationSessionChange(() =>
      sessionChanges.push("changed"),
    );
    const otherTab = new FakeBroadcastChannel("rhasia-scret:vault-session-change");
    otherTab.addEventListener("message", (event) => received.push(event.data));

    otherTab.postMessage({ type: "session-changed", changeId: "synthetic-change-id-remote" });

    expect(lifecycle.workspace).toBeNull();
    expect(workspace.userRootKey).toEqual(Uint8Array.of(0, 0));
    expect(workspace.personalVaultKey).toEqual(Uint8Array.of(0, 0));
    expect(workspace.accountSecret).toEqual(Uint8Array.of(0, 0));
    expect(sessionChanges).toEqual(["changed"]);
    browserVaultLock.requestVaultSessionChange();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: "session-changed" });
    expect(received[0]).toHaveProperty("changeId");
    expect(sessionChanges).toEqual(["changed", "changed"]);
    unsubscribeSessionChanges();
    lifecycle.dispose();
    otherTab.close();
  });

  it("invalidates tracked sensitive results on remote session change without a workspace subscriber", async () => {
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    let resolveOperation: ((value: Uint8Array) => void) | undefined;
    const result = Uint8Array.of(7, 8);
    const clearStaleResult = vi.fn((value: Uint8Array) => value.fill(0));
    const operation = browserVaultLock.trackVaultSensitiveOperation(
      () =>
        new Promise<Uint8Array>((resolve) => {
          resolveOperation = resolve;
        }),
      clearStaleResult,
    );
    const otherTab = new FakeBroadcastChannel("rhasia-scret:vault-session-change");

    otherTab.postMessage({ type: "session-changed", changeId: "synthetic-change-id-tracked-operation" });
    resolveOperation?.(result);

    await expect(operation).rejects.toThrow();
    expect(clearStaleResult).toHaveBeenCalledWith(result);
    expect(result).toEqual(Uint8Array.of(0, 0));
    otherTab.close();
  });

  it("dispatches a single cross-tab lock for multiple local lock subscribers", () => {
    const originalWindow = window;
    const testWindow = createTestWindow();
    setWindowContext(testWindow);
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const firstLock = vi.fn();
    const secondLock = vi.fn();
    const sessionChanges = vi.fn();
    const unsubscribeFirst = browserVaultLock.subscribeToLocalVaultLock(firstLock);
    const unsubscribeSecond = browserVaultLock.subscribeToLocalVaultLock(secondLock);
    const unsubscribeSessionChanges = subscribeToBrowserAuthenticationSessionChange(sessionChanges);
    const otherTab = new FakeBroadcastChannel("rhasia-scret:vault-session-change");

    otherTab.postMessage({ type: "session-changed", changeId: "synthetic-change-id-lock" });

    expect(firstLock).toHaveBeenCalledOnce();
    expect(secondLock).toHaveBeenCalledOnce();
    expect(sessionChanges).toHaveBeenCalledOnce();
    unsubscribeFirst();
    unsubscribeSecond();
    unsubscribeSessionChanges();
    otherTab.close();
    setWindowContext(originalWindow);
  });

  it.each(["unavailable", "throws", "receiver-fails"] as const)(
    "clears the other same-origin workspace through the storage fallback when BroadcastChannel is %s",
    (channelAvailability) => {
      const senderWindow = createTestWindow();
      const receiverWindow = createTestWindow();
      const originalWindow = window;
      const storageValues = new Map<string, string>();
      const storageOperations: string[] = [];

      const dispatchToReceiver = (key: string, oldValue: string | null, newValue: string | null) => {
        setWindowContext(receiverWindow);
        try {
          receiverWindow.dispatchEvent(
            new receiverWindow.StorageEvent("storage", {
              key,
              oldValue,
              newValue,
              url: senderWindow.location.href,
            }),
          );
        } finally {
          setWindowContext(senderWindow);
        }
      };
      const storage: Storage = {
        get length() {
          return storageValues.size;
        },
        clear: () => storageValues.clear(),
        getItem: (key) => storageValues.get(key) ?? null,
        key: (index) => [...storageValues.keys()][index] ?? null,
        removeItem: (key) => {
          const oldValue = storageValues.get(key) ?? null;
          storageValues.delete(key);
          storageOperations.push(`remove:${key}`);
          dispatchToReceiver(key, oldValue, null);
        },
        setItem: (key, value) => {
          const oldValue = storageValues.get(key) ?? null;
          storageValues.set(key, value);
          storageOperations.push(`set:${key}:${value}`);
          dispatchToReceiver(key, oldValue, value);
        },
      };
      Object.defineProperty(senderWindow, "localStorage", { configurable: true, value: storage });

      if (channelAvailability === "unavailable") {
        vi.stubGlobal("BroadcastChannel", undefined);
      } else if (channelAvailability === "throws") {
        vi.stubGlobal(
          "BroadcastChannel",
          class {
            public constructor() {
              throw new Error("Synthetic BroadcastChannel construction failure.");
            }
          },
        );
      } else {
        vi.stubGlobal(
          "BroadcastChannel",
          class extends FakeBroadcastChannel {
            public constructor(name: string) {
              if (window === receiverWindow) throw new Error("Synthetic receiver channel construction failure.");
              super(name);
            }
          },
        );
      }

      const sessionChanges: string[] = [];
      setWindowContext(receiverWindow);
      const unsubscribeSessionChanges = subscribeToBrowserAuthenticationSessionChange(() =>
        sessionChanges.push("changed"),
      );
      setWindowContext(senderWindow);

      const workspace: TestWorkspace = {
        profileId: "synthetic-profile",
        syncState: "CURRENT",
        userRootKey: Uint8Array.of(1, 2),
        personalVaultKey: Uint8Array.of(3, 4),
        accountSecret: Uint8Array.of(5, 6),
      };
      const ports: WorkspaceLifecyclePorts<TestWorkspace> = {
        network: { isOnline: () => false, subscribe: () => () => undefined },
        applicationLifecycle: { isVisible: () => false, subscribeVisibility: () => () => undefined },
        lock: browserVaultLock.browserVaultLockPort,
        writes: { setReadOnly: () => undefined },
        workspace: {
          refresh: async () => {
            throw new Error("unexpected refresh");
          },
          clear: (value) => {
            value?.userRootKey.fill(0);
            value?.personalVaultKey.fill(0);
            value?.accountSecret.fill(0);
          },
          classifyFailure: () => "SYNC",
          readOnlyReason: () => "synthetic workspace",
        },
      };
      const lifecycle = new WorkspaceLifecycle(workspace, ports);
      setWindowContext(receiverWindow);
      lifecycle.start();

      setWindowContext(senderWindow);
      browserVaultLock.requestVaultSessionChange();

      expect(lifecycle.workspace).toBeNull();
      expect(workspace.userRootKey).toEqual(Uint8Array.of(0, 0));
      expect(workspace.personalVaultKey).toEqual(Uint8Array.of(0, 0));
      expect(workspace.accountSecret).toEqual(Uint8Array.of(0, 0));
      expect(sessionChanges).toEqual(["changed"]);
      expect(storageOperations).toHaveLength(2);
      expect(storageOperations[0]).toMatch(/^set:rhasia-scret:session-change:[a-zA-Z0-9-]+$/);
      expect(storageOperations[1]).toBe("remove:rhasia-scret:session-change");
      expect(storageValues.size).toBe(0);

      setWindowContext(receiverWindow);
      unsubscribeSessionChanges();
      lifecycle.dispose();
      setWindowContext(originalWindow);
    },
  );
});
