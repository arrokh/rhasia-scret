/** @vitest-environment jsdom */

import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_COMPLETION_PATH } from "@/modules/identity/application/auth-return-path";
import { InvitationAuthContinuation } from "@/modules/identity/presentation/invitation-auth-continuation";
import {
  clearPendingSecureShareLinkAuthentication,
  SECURE_SHARE_LINK_MEMORY_MAX_AGE_MS,
} from "@/modules/vault-membership";
import { QueryProvider } from "@/shared/presentation/query-provider";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type MessageListener = (event: MessageEvent<unknown>) => void;
const channels = new Set<FakeBroadcastChannel>();
let messageDelayMs = 0;

class FakeBroadcastChannel {
  private readonly listeners = new Set<MessageListener>();
  public readonly messages: unknown[] = [];

  public constructor(public readonly name: string) {
    channels.add(this);
  }

  public addEventListener(type: string, listener: MessageListener): void {
    if (type === "message") this.listeners.add(listener);
  }

  public removeEventListener(type: string, listener: MessageListener): void {
    if (type === "message") this.listeners.delete(listener);
  }

  public postMessage(data: unknown): void {
    this.messages.push(data);
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

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  clearPendingSecureShareLinkAuthentication();
  for (const channel of channels) {
    if (channel.name !== "rhasia-scret:vault-session-change") channel.close();
  }
  messageDelayMs = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("InvitationAuthContinuation", () => {
  it("removes the fragment and redeems from the invitation tab after authentication", async () => {
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    window.history.replaceState(
      null,
      "",
      "/sign-in?next=%2Fvaults%2Finvitations%2Fredeem#synthetic-invitation-secret-000000000000000",
    );
    const navigate = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          StrictMode,
          null,
          createElement(InvitationAuthContinuation, { nextPath: "/vaults/invitations/redeem", navigate }),
        ),
      );
    });

    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?next=%2Fvaults%2Finvitations%2Fredeem");
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);

    const callback = new FakeBroadcastChannel("rhasia-scret:authentication-complete");
    callback.postMessage({ type: "authenticated" });
    callback.postMessage({ type: "authenticated" });

    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining("/vaults/invitations/redeem#synthetic-invitation-secret-000000000000000"),
    );
    expect(callback.messages).toEqual([{ type: "authenticated" }, { type: "authenticated" }]);
    callback.close();
  });

  it("replaces the invitation secret when another invitation link opens in the same tab", async () => {
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    window.history.replaceState(
      null,
      "",
      "/sign-in?next=%2Fvaults%2Finvitations%2Fredeem#first-secure-share-secret-00000000000000000",
    );
    const navigate = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(InvitationAuthContinuation, { nextPath: "/vaults/invitations/redeem", navigate }));
    });
    window.history.replaceState(
      null,
      "",
      "/sign-in?next=%2Fvaults%2Finvitations%2Fredeem#account-settings-security-notice",
    );
    await act(async () => window.dispatchEvent(new HashChangeEvent("hashchange")));
    expect(window.location.hash).toBe("#account-settings-security-notice");
    window.history.replaceState(
      null,
      "",
      "/sign-in?next=%2Fvaults%2Finvitations%2Fredeem#second-secure-share-secret-0000000000000000",
    );
    await act(async () => window.dispatchEvent(new HashChangeEvent("hashchange")));
    expect(window.location.hash).toBe("");

    const callback = new FakeBroadcastChannel("rhasia-scret:authentication-complete");
    callback.postMessage({ type: "authenticated" });

    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining("/vaults/invitations/redeem#second-secure-share-secret-0000000000000000"),
    );
    expect(navigate).not.toHaveBeenCalledWith(expect.stringContaining("first-secure-share-secret-00000000000000000"));
    callback.close();
  });

  it("keeps the in-memory invitation secret while a background tab delays authentication delivery", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    messageDelayMs = 7_000;
    window.history.replaceState(
      null,
      "",
      "/sign-in?next=%2Fvaults%2Finvitations%2Fredeem#synthetic-invitation-secret-000000000000000",
    );
    const navigate = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          StrictMode,
          null,
          createElement(InvitationAuthContinuation, { nextPath: "/vaults/invitations/redeem", navigate }),
        ),
      );
    });

    const callback = new FakeBroadcastChannel("rhasia-scret:authentication-complete");
    callback.postMessage({ type: "authenticated" });
    expect(navigate).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_000);
    });

    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining("/vaults/invitations/redeem#synthetic-invitation-secret-000000000000000"),
    );
    callback.close();
  });

  it("clears the in-memory invitation secret when authentication leaves that return path", async () => {
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    window.history.replaceState(
      null,
      "",
      "/sign-in?next=%2Fvaults%2Finvitations%2Fredeem#synthetic-invitation-secret-000000000000000",
    );
    const navigate = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          StrictMode,
          null,
          createElement(InvitationAuthContinuation, { nextPath: "/vaults/invitations/redeem", navigate }),
        ),
      );
    });
    await act(async () => {
      root?.render(
        createElement(StrictMode, null, createElement(InvitationAuthContinuation, { nextPath: "/vaults", navigate })),
      );
    });

    const callback = new FakeBroadcastChannel("rhasia-scret:authentication-complete");
    callback.postMessage({ type: "authenticated" });

    expect(navigate).not.toHaveBeenCalled();
    callback.close();
  });

  it("expires a pending invitation secret after the maximum authentication link lifetime", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    window.history.replaceState(
      null,
      "",
      "/sign-in?next=%2Fvaults%2Finvitations%2Fredeem#synthetic-invitation-secret-000000000000000",
    );
    const navigate = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(InvitationAuthContinuation, { nextPath: "/vaults/invitations/redeem", navigate }));
    });

    await act(async () => vi.advanceTimersByTimeAsync(SECURE_SHARE_LINK_MEMORY_MAX_AGE_MS));
    const callback = new FakeBroadcastChannel("rhasia-scret:authentication-complete");
    callback.postMessage({ type: "authenticated" });

    expect(navigate).toHaveBeenCalledWith(AUTH_COMPLETION_PATH);
    expect(navigate.mock.calls.flat().join(" ")).not.toContain("synthetic-invitation-secret-000000000000000");
    callback.close();
  });

  it("opens recovery guidance when authentication completes without the invitation secret", async () => {
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    window.history.replaceState(null, "", "/sign-in?next=%2Fvaults%2Finvitations%2Fredeem");
    const navigate = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          StrictMode,
          null,
          createElement(InvitationAuthContinuation, {
            nextPath: "/vaults/invitations/redeem",
            navigate,
          }),
        ),
      );
    });

    const callback = new FakeBroadcastChannel("rhasia-scret:authentication-complete");
    callback.postMessage({ type: "authenticated" });
    callback.postMessage({ type: "authenticated" });

    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(AUTH_COMPLETION_PATH);
    callback.close();
  });

  it("retains the invitation secret when a session change remounts the sign-in subtree before auth completion", async () => {
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    window.history.replaceState(
      null,
      "",
      "/sign-in?next=%2Fvaults%2Finvitations%2Fredeem#synthetic-invitation-secret-000000000000000",
    );
    const navigate = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          QueryProvider,
          null,
          createElement(InvitationAuthContinuation, { nextPath: "/vaults/invitations/redeem", navigate }),
        ),
      );
    });
    expect(window.location.hash).toBe("");

    const otherTab = new FakeBroadcastChannel("rhasia-scret:vault-session-change");
    await act(async () => {
      otherTab.postMessage({ type: "session-changed", changeId: "synthetic-session-change-id" });
    });
    expect(navigate).not.toHaveBeenCalled();

    const callback = new FakeBroadcastChannel("rhasia-scret:authentication-complete");
    await act(async () => callback.postMessage({ type: "authenticated" }));

    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining("/vaults/invitations/redeem#synthetic-invitation-secret-000000000000000"),
    );
    otherTab.close();
    callback.close();
  });

  it("ignores the storage fallback after the channel has already continued with its secret", async () => {
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    window.history.replaceState(
      null,
      "",
      "/sign-in?next=%2Fvaults%2Finvitations%2Fredeem#synthetic-invitation-secret-000000000000000",
    );
    const navigate = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(InvitationAuthContinuation, { nextPath: "/vaults/invitations/redeem", navigate }));
    });

    const callback = new FakeBroadcastChannel("rhasia-scret:authentication-complete");
    callback.postMessage({ type: "authenticated" });
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "rhasia-scret:authentication-complete",
        newValue: "authenticated",
      }),
    );

    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining("/vaults/invitations/redeem#synthetic-invitation-secret-000000000000000"),
    );
    callback.close();
  });

  it("does not consume fragments for unrelated authentication destinations", async () => {
    window.history.replaceState(null, "", "/sign-in#unrelated-client-state");
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(StrictMode, null, createElement(InvitationAuthContinuation, { nextPath: "/vaults" })));
    });

    expect(window.location.hash).toBe("#unrelated-client-state");
  });
});
