import { afterEach, describe, expect, it, vi } from "vitest";

import {
  announceAuthenticationCompletion,
  subscribeToAuthenticationCompletion,
} from "@/modules/identity/presentation/auth-completion-channel";

type MessageListener = (event: MessageEvent<unknown>) => void;

const channels = new Set<FakeBroadcastChannel>();

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
    vi.unstubAllGlobals();
  });

  it("announces authentication without sending invitation material", () => {
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const onComplete = vi.fn();
    const unsubscribe = subscribeToAuthenticationCompletion(onComplete);

    announceAuthenticationCompletion();

    expect(onComplete).toHaveBeenCalledOnce();
    unsubscribe();
    announceAuthenticationCompletion();
    expect(onComplete).toHaveBeenCalledOnce();
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
});
