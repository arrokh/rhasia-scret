/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requestVaultSessionChange: vi.fn() }));
vi.mock("@/modules/sync", () => ({ requestVaultSessionChange: mocks.requestVaultSessionChange }));

import {
  announceAuthenticationCompletion,
  subscribeToAuthenticationCompletion,
} from "@/modules/identity/presentation/auth-completion-channel";

type MessageListener = (event: MessageEvent<unknown>) => void;
const channels = new Set<FakeBroadcastChannel>();
const postedMessages: unknown[] = [];

class FakeBroadcastChannel {
  private readonly listeners = new Set<MessageListener>();

  public constructor(private readonly name: string) {
    channels.add(this);
  }

  public addEventListener(type: string, listener: MessageListener): void {
    if (type === "message") this.listeners.add(listener);
  }

  public removeEventListener(type: string, listener: MessageListener): void {
    if (type === "message") this.listeners.delete(listener);
  }

  public postMessage(data: unknown): void {
    postedMessages.push(data);
    for (const channel of channels) {
      if (channel === this || channel.name !== this.name) continue;
      for (const listener of channel.listeners) listener(new MessageEvent("message", { data }));
    }
  }

  public close(): void {
    channels.delete(this);
  }
}

describe("auth completion channel", () => {
  afterEach(() => {
    channels.clear();
    postedMessages.length = 0;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("announces authentication without sending invitation material", () => {
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const onComplete = vi.fn();
    const unsubscribe = subscribeToAuthenticationCompletion(onComplete);

    announceAuthenticationCompletion();

    expect(onComplete).toHaveBeenCalledOnce();
    expect(mocks.requestVaultSessionChange).toHaveBeenCalledOnce();
    expect(postedMessages).toEqual([{ type: "authenticated" }]);
    unsubscribe();
    announceAuthenticationCompletion();
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("notifies the source tab even when the session-change announcement fails", () => {
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const onComplete = vi.fn();
    const unsubscribe = subscribeToAuthenticationCompletion(onComplete);
    mocks.requestVaultSessionChange.mockImplementationOnce(() => {
      throw new Error("synthetic session-change failure");
    });

    expect(announceAuthenticationCompletion).not.toThrow();
    expect(onComplete).toHaveBeenCalledOnce();
    expect(postedMessages).toEqual([{ type: "authenticated" }]);

    unsubscribe();
  });

  it("ignores unrelated messages", () => {
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const onComplete = vi.fn();
    const unsubscribe = subscribeToAuthenticationCompletion(onComplete);
    const sender = new FakeBroadcastChannel("rhasia-scret:authentication-complete");

    sender.postMessage({ type: "unrelated" });

    expect(onComplete).not.toHaveBeenCalled();
    unsubscribe();
    sender.close();
  });

  it("uses the sender's local signal and a separate receiver's storage signal when channel construction fails", () => {
    const sourceWindow = window;
    const localStorage = sourceWindow.localStorage;
    const receiverWindow = new EventTarget();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        public constructor() {
          throw new Error("unavailable");
        }
      },
    );
    const onSourceComplete = vi.fn();
    const unsubscribeSource = subscribeToAuthenticationCompletion(onSourceComplete);
    vi.stubGlobal("window", receiverWindow);
    const onReceiverComplete = vi.fn();
    const unsubscribeReceiver = subscribeToAuthenticationCompletion(onReceiverComplete);

    vi.stubGlobal("window", sourceWindow);
    expect(announceAuthenticationCompletion).not.toThrow();
    expect(onSourceComplete).toHaveBeenCalledOnce();
    expect(onReceiverComplete).not.toHaveBeenCalled();
    expect(mocks.requestVaultSessionChange).toHaveBeenCalledOnce();
    expect(setItem).toHaveBeenCalledWith("rhasia-scret:authentication-complete", "authenticated");
    expect(removeItem).toHaveBeenCalledWith("rhasia-scret:authentication-complete");
    expect(setItem.mock.contexts).toContain(localStorage);
    expect(removeItem.mock.contexts).toContain(localStorage);

    receiverWindow.dispatchEvent(
      new StorageEvent("storage", {
        key: "rhasia-scret:authentication-complete",
        newValue: "authenticated",
      }),
    );
    expect(onReceiverComplete).toHaveBeenCalledOnce();
    vi.stubGlobal("window", receiverWindow);
    unsubscribeReceiver();
    vi.stubGlobal("window", sourceWindow);
    unsubscribeSource();
  });

  it("falls back to local and storage completion signals when channel posting fails", () => {
    const localStorage = window.localStorage;
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    class ThrowingPostBroadcastChannel extends FakeBroadcastChannel {
      public override postMessage(_data: unknown): void {
        throw new Error("unavailable");
      }
    }
    vi.stubGlobal("BroadcastChannel", ThrowingPostBroadcastChannel);
    const onComplete = vi.fn();
    const unsubscribe = subscribeToAuthenticationCompletion(onComplete);

    expect(announceAuthenticationCompletion).not.toThrow();

    expect(onComplete).toHaveBeenCalledOnce();
    expect(mocks.requestVaultSessionChange).toHaveBeenCalledOnce();
    expect(setItem).toHaveBeenCalledWith("rhasia-scret:authentication-complete", "authenticated");
    expect(removeItem).toHaveBeenCalledWith("rhasia-scret:authentication-complete");
    expect(setItem.mock.contexts).toContain(localStorage);
    expect(removeItem.mock.contexts).toContain(localStorage);
    unsubscribe();
  });
});
