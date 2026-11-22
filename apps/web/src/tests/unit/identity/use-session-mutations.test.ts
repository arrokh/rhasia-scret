/** @vitest-environment jsdom */

import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mocks = vi.hoisted(() => ({
  clearAllOfflineVaultData: vi.fn(),
  postSessionRevocation: vi.fn(),
  requestLocalVaultLock: vi.fn(),
  requestVaultSessionChange: vi.fn(),
}));
vi.mock("@/modules/sync", () => ({
  clearAllOfflineVaultData: mocks.clearAllOfflineVaultData,
  requestLocalVaultLock: mocks.requestLocalVaultLock,
  requestVaultSessionChange: mocks.requestVaultSessionChange,
}));
vi.mock("@/shared/infrastructure/browser-api-client", () => ({
  browserApiClient: { postSessionRevocation: mocks.postSessionRevocation },
}));

import { useTerminateSessionMutation } from "@/modules/identity/presentation/hooks/use-session-mutations";

let root: Root | undefined;
let client: QueryClient | undefined;
let startMutation: (() => Promise<string>) | undefined;
let previousOnlineState: boolean;

function MutationHarness() {
  const { mutateAsync } = useTerminateSessionMutation();
  useEffect(() => {
    startMutation = () => mutateAsync();
    return () => {
      startMutation = undefined;
    };
  }, [mutateAsync]);
  return null;
}

beforeEach(() => {
  previousOnlineState = onlineManager.isOnline();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  client?.clear();
  client = undefined;
  startMutation = undefined;
  onlineManager.setOnline(previousOnlineState);
  vi.resetAllMocks();
  document.body.innerHTML = "";
});

describe("useTerminateSessionMutation", () => {
  it("locks and clears local state before the offline server-revocation attempt", async () => {
    const order: string[] = [];
    onlineManager.setOnline(false);
    mocks.requestLocalVaultLock.mockImplementation(() => order.push("local-lock"));
    mocks.clearAllOfflineVaultData.mockImplementation(async () => order.push("local-clear"));
    mocks.postSessionRevocation.mockImplementation(async () => {
      expect(onlineManager.isOnline()).toBe(false);
      order.push("server-logout");
      throw new Error("synthetic offline network failure");
    });
    mocks.requestVaultSessionChange.mockImplementation(() => {
      mocks.requestLocalVaultLock();
      order.push("cross-tab-lock");
    });
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } });
    client = queryClient;
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(QueryClientProvider, { client: queryClient }, createElement(MutationHarness)));
    });
    const execute = startMutation;
    if (!execute) throw new Error("The logout mutation did not mount.");

    let failure: unknown;
    await act(async () => {
      try {
        await execute();
      } catch (error) {
        failure = error;
      }
    });

    expect(failure).toEqual(new Error("synthetic offline network failure"));
    expect(order).toEqual([
      "local-lock",
      "cross-tab-lock",
      "local-clear",
      "server-logout",
      "local-lock",
      "cross-tab-lock",
    ]);
  });
});
