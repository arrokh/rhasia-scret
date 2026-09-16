/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  announceAuthenticationCompletion,
  requestInvitationSecret,
  subscribeToAuthenticationCompletion,
} from "@/modules/identity/presentation/auth-completion-channel";

type MessageListener = (event: MessageEvent<unknown>) => void;

const channels = new Set<FakeBroadcastChannel>();
let messageDelayMs = 0;

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
    const deliver = () => {
      for (const channel of channels) {
        if (channel === this || channel.name !== this.name) continue;
        for (const listener of channel.listeners) listener(new MessageEvent("message", { data }));
      }
    };
    if (messageDelayMs > 0) window.setTimeout(deliver, messageDelayMs);
    else deliver();
  }

  public close(): void {
    channels.delete(this);
  }
}

describe("auth completion channel", () => {
  afterEach(() => {
    channels.clear();
    messageDelayMs = 0;
    vi.useRealTimers();
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

  it("hands the invitation fragment between open client tabs without persistence", async () => {
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    vi.stubGlobal("crypto", { randomUUID: () => "request-id" });
    const unsubscribe = subscribeToAuthenticationCompletion(
      () => undefined,
      () => "invitation-secret-value",
    );

    await expect(requestInvitationSecret()).resolves.toBe("invitation-secret-value");

    unsubscribe();
  });

  it("waits up to 15 seconds for a backgrounded invitation tab to answer the secret request", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    vi.stubGlobal("crypto", { randomUUID: () => "request-id" });
    messageDelayMs = 7_000;
    const unsubscribe = subscribeToAuthenticationCompletion(
      () => undefined,
      () => "invitation-secret-value",
    );

    const secret = requestInvitationSecret();
    await vi.advanceTimersByTimeAsync(14_500);

    await expect(secret).resolves.toBe("invitation-secret-value");
    unsubscribe();
  });
});
