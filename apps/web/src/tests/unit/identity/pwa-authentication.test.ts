/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { INVITATION_AUTH_RETURN_PATH } from "@/modules/identity/application/auth-return-path";
import {
  announcePwaAuthenticationCompletion,
  clearPwaAuthenticationHandoff,
  clearPwaAuthenticationProvisionalHandoff,
  createPwaAuthenticationHandoff,
  readPwaAuthenticationHandoff,
  readPwaAuthenticationHandoffById,
  readPwaAuthenticationHandoffExpiresAt,
  readProvisionalPwaAuthenticationHandoff,
  requestPwaAuthenticationVerifier,
  storePwaAuthenticationHandoff,
  storeProvisionalPwaAuthenticationHandoff,
  subscribeToPwaAuthenticationCompletion,
} from "@/modules/identity/infrastructure/pwa-authentication";

const channels = new Set<FakeBroadcastChannel>();
type MessageListener = (event: MessageEvent<unknown>) => void;

class FakeBroadcastChannel {
  private readonly listeners = new Set<MessageListener>();

  public constructor(private readonly name: string) {
    channels.add(this);
  }

  public addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type !== "message") return;
    this.listeners.add(listener as MessageListener);
  }

  public removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type !== "message") return;
    this.listeners.delete(listener as MessageListener);
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

afterEach(() => {
  channels.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PWA authentication handoff storage", () => {
  it("keeps a generated verifier in memory until an accepted request is stored", () => {
    const setItem = vi.spyOn(window.sessionStorage, "setItem");
    const handoff = createPwaAuthenticationHandoff();

    expect(setItem).not.toHaveBeenCalled();
    storePwaAuthenticationHandoff(handoff, 1_800_000_000_000);
    expect(readPwaAuthenticationHandoff()).toEqual(handoff);
    expect(readPwaAuthenticationHandoffExpiresAt(handoff.handoffId)).toBe(1_800_000_000_000);
  });

  it("keeps a provisional verifier separate until the server accepts the request", () => {
    const activeHandoff = { handoffId: "pwa-handoff-active-123", verifier: "a".repeat(43) };
    const provisionalHandoff = { handoffId: "pwa-handoff-new-123", verifier: "n".repeat(43) };
    storePwaAuthenticationHandoff(activeHandoff, 1_800_000_000_000);
    storeProvisionalPwaAuthenticationHandoff(provisionalHandoff, 1_800_000_060_000);

    expect(readPwaAuthenticationHandoff()).toEqual(activeHandoff);
    expect(readPwaAuthenticationHandoffById(provisionalHandoff.handoffId)).toEqual(provisionalHandoff);
    expect(readProvisionalPwaAuthenticationHandoff()).toEqual({
      handoff: provisionalHandoff,
      expiresAt: 1_800_000_060_000,
    });

    storePwaAuthenticationHandoff(provisionalHandoff, 1_800_000_120_000);

    expect(readPwaAuthenticationHandoff()).toEqual(provisionalHandoff);
    expect(readProvisionalPwaAuthenticationHandoff()).toBeNull();
  });

  it("ignores an expired active handoff without deleting a newer provisional one", () => {
    const expiredHandoff = { handoffId: "pwa-handoff-old-123", verifier: "o".repeat(43) };
    const provisionalHandoff = { handoffId: "pwa-handoff-new-123", verifier: "n".repeat(43) };
    storePwaAuthenticationHandoff(expiredHandoff, Date.now() - 1);
    storeProvisionalPwaAuthenticationHandoff(provisionalHandoff, Date.now() + 60_000);

    expect(readPwaAuthenticationHandoff()).toBeNull();
    expect(readProvisionalPwaAuthenticationHandoff()?.handoff).toEqual(provisionalHandoff);
    expect(readPwaAuthenticationHandoffById(provisionalHandoff.handoffId)).toEqual(provisionalHandoff);
  });

  it("clears a failed provisional handoff without deleting the previous valid one", () => {
    const activeHandoff = { handoffId: "pwa-handoff-active-123", verifier: "a".repeat(43) };
    const provisionalHandoff = { handoffId: "pwa-handoff-new-123", verifier: "n".repeat(43) };
    storePwaAuthenticationHandoff(activeHandoff, 1_800_000_000_000);
    storeProvisionalPwaAuthenticationHandoff(provisionalHandoff, 1_800_000_060_000);

    clearPwaAuthenticationProvisionalHandoff(provisionalHandoff.handoffId);

    expect(readPwaAuthenticationHandoff()).toEqual(activeHandoff);
    expect(readPwaAuthenticationHandoffById(provisionalHandoff.handoffId)).toBeNull();
  });

  it("does not let a stale completion clear a newer handoff", () => {
    const oldHandoff = { handoffId: "pwa-handoff-old-123", verifier: "o".repeat(43) };
    const currentHandoff = { handoffId: "pwa-handoff-new-123", verifier: "n".repeat(43) };
    storePwaAuthenticationHandoff(oldHandoff, 1_800_000_000_000);
    storePwaAuthenticationHandoff(currentHandoff, 1_800_000_060_000);

    clearPwaAuthenticationHandoff(oldHandoff.handoffId);

    expect(readPwaAuthenticationHandoff()).toEqual(currentHandoff);
    expect(readPwaAuthenticationHandoffExpiresAt(currentHandoff.handoffId)).toBe(1_800_000_060_000);
  });
});

describe("PWA authentication completion channel", () => {
  it("notifies the matching same-origin PWA window with a validated return path", () => {
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const onComplete = vi.fn();
    const unsubscribe = subscribeToPwaAuthenticationCompletion(onComplete);

    announcePwaAuthenticationCompletion("pwa-handoff-123456", INVITATION_AUTH_RETURN_PATH);

    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith("pwa-handoff-123456", INVITATION_AUTH_RETURN_PATH);
    unsubscribe();
  });

  it("ignores completion messages with unsupported return paths", () => {
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const onComplete = vi.fn();
    const unsubscribe = subscribeToPwaAuthenticationCompletion(onComplete);
    const sender = new FakeBroadcastChannel("rhasia-scret:pwa-authentication-handoff");

    sender.postMessage({
      type: "completed",
      handoffId: "pwa-handoff-123456",
      returnPath: "https://example.invalid/",
    });

    expect(onComplete).not.toHaveBeenCalled();
    unsubscribe();
    sender.close();
  });

  it("fails closed when BroadcastChannel construction is unavailable", async () => {
    class UnavailableBroadcastChannel {
      public constructor() {
        throw new Error("synthetic channel failure");
      }
    }
    vi.stubGlobal("BroadcastChannel", UnavailableBroadcastChannel);

    expect(() => announcePwaAuthenticationCompletion("pwa-handoff-123456", INVITATION_AUTH_RETURN_PATH)).not.toThrow();
    expect(() => subscribeToPwaAuthenticationCompletion(vi.fn())).not.toThrow();
    await expect(requestPwaAuthenticationVerifier("pwa-handoff-123456")).resolves.toBeNull();
  });
});
