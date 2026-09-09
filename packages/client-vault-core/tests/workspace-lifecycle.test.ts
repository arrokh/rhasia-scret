import { describe, expect, it, vi } from "vitest";
import {
  WorkspaceLifecycle,
  WorkspaceLifecycleCancelledError,
  type WorkspaceLifecyclePorts,
} from "../src/modules/sync/application/workspace-lifecycle";
import type {
  ApplicationLifecyclePort,
  NetworkStatusPort,
  PortDisposer,
} from "../src/shared/application/platform-ports";

type Workspace = {
  profileId: string;
  syncState: "OFFLINE" | "STALE" | "SYNCING" | "CURRENT" | "AUTH_REQUIRED" | "ERROR" | "LOCAL_STORAGE_ERROR";
  userRootKey: Uint8Array;
  value: string;
};

class Network implements NetworkStatusPort {
  online = true;
  listener?: (online: boolean) => void;
  isOnline() {
    return this.online;
  }
  subscribe(listener: (online: boolean) => void): PortDisposer {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }
  change(online: boolean) {
    this.online = online;
    this.listener?.(online);
  }
}

class Lifecycle implements ApplicationLifecyclePort {
  listener?: (visible: boolean) => void;
  isVisible() {
    return true;
  }
  subscribeVisibility(listener: (visible: boolean) => void): PortDisposer {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }
}

function workspace(syncState: Workspace["syncState"] = "CURRENT", value = "old"): Workspace {
  return { profileId: "profile-1", syncState, userRootKey: Uint8Array.of(7, 8), value };
}

function harness(initial = workspace("CURRENT")) {
  const network = new Network();
  const applicationLifecycle = new Lifecycle();
  let lockListener: (() => void) | undefined;
  const cleared: Workspace[] = [];
  const writeReasons: Array<string | null> = [];
  const refresh = vi.fn<WorkspaceLifecyclePorts<Workspace>["workspace"]["refresh"]>();
  const ports: WorkspaceLifecyclePorts<Workspace> = {
    network,
    applicationLifecycle,
    lock: {
      subscribe: (listener) => {
        lockListener = listener;
        return () => {
          lockListener = undefined;
        };
      },
    },
    writes: { setReadOnly: (reason) => writeReasons.push(reason) },
    workspace: {
      refresh,
      clear: (value) => {
        if (value) {
          cleared.push(value);
          value.userRootKey.fill(0);
        }
      },
      classifyFailure: (error) =>
        error instanceof Error && error.message === "auth"
          ? "AUTHENTICATION"
          : error instanceof Error && error.message === "storage"
            ? "LOCAL_STORAGE"
            : "SYNC",
      readOnlyReason: (value) => `Workspace is ${value.syncState}.`,
    },
  };
  const controller = new WorkspaceLifecycle(initial, ports);
  return { applicationLifecycle, cleared, controller, lock: () => lockListener?.(), network, refresh, writeReasons };
}

describe("WorkspaceLifecycle", () => {
  it("centralizes network transitions, reconciliation, replacement cleanup, and write gating", async () => {
    const test = harness();
    test.controller.start();
    test.network.change(false);
    expect(test.controller.workspace?.syncState).toBe("OFFLINE");
    expect(test.writeReasons.at(-1)).toBe("Workspace is OFFLINE.");

    const refreshed = workspace("CURRENT", "new");
    test.refresh.mockResolvedValue(refreshed);
    test.network.change(true);
    await vi.waitFor(() => expect(test.controller.workspace?.value).toBe("new"));

    expect(test.controller.workspace?.syncState).toBe("CURRENT");
    expect(test.writeReasons.at(-1)).toBeNull();
    expect(test.cleared).toHaveLength(1);
    expect(test.cleared[0]?.userRootKey).toEqual(Uint8Array.of(0, 0));
    expect(refreshed.userRootKey).toEqual(Uint8Array.of(7, 8));
  });

  it.each([
    [new Error("auth"), "AUTH_REQUIRED"],
    [new Error("storage"), "LOCAL_STORAGE_ERROR"],
    [new Error("sync"), "STALE"],
  ] as const)("classifies reconciliation failure %s", async (failure, expected) => {
    const test = harness(workspace("OFFLINE"));
    test.refresh.mockRejectedValue(failure);
    test.controller.start();
    await vi.waitFor(() => expect(test.controller.workspace?.syncState).toBe(expected));
    expect(test.writeReasons.at(-1)).toBe(`Workspace is ${expected}.`);
  });

  it("cancels an in-flight refresh and clears its late result after lock", async () => {
    const test = harness(workspace("OFFLINE"));
    let resolveRefresh: ((value: Workspace) => void) | undefined;
    let observedCancellation = false;
    test.refresh.mockImplementation(
      (_key, _profileId, cancellation) =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
          cancellation.subscribe(() => {
            observedCancellation = true;
          });
        }),
    );
    test.controller.start();
    await vi.waitFor(() => expect(test.refresh).toHaveBeenCalledOnce());

    test.lock();
    const late = workspace("CURRENT", "late");
    resolveRefresh?.(late);
    await vi.waitFor(() => expect(test.cleared).toContain(late));

    expect(observedCancellation).toBe(true);
    expect(test.controller.workspace).toBeNull();
    expect(late.userRootKey).toEqual(Uint8Array.of(0, 0));
  });

  it("rejects an explicit authorization refresh when lock cancels it", async () => {
    const test = harness(workspace("CURRENT"));
    let resolveRefresh: ((value: Workspace) => void) | undefined;
    test.refresh.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    test.controller.start();

    const refreshing = test.controller.refreshAuthorization();
    await vi.waitFor(() => expect(test.refresh).toHaveBeenCalledOnce());
    test.lock();
    resolveRefresh?.(workspace("CURRENT", "late-authorization"));

    await expect(refreshing).rejects.toBeInstanceOf(WorkspaceLifecycleCancelledError);
  });

  it("clears key material and subscriptions on disposal", () => {
    const initial = workspace();
    const test = harness(initial);
    test.controller.start();
    test.controller.dispose();

    expect(initial.userRootKey).toEqual(Uint8Array.of(0, 0));
    expect(test.controller.workspace).toBeNull();
    expect(test.network.listener).toBeUndefined();
    expect(test.applicationLifecycle.listener).toBeUndefined();
    expect(test.writeReasons.at(-1)).toBeNull();
  });

  it("stops platform listeners without clearing the current workspace", () => {
    const initial = workspace();
    const test = harness(initial);
    test.controller.start();
    test.controller.stop();

    expect(initial.userRootKey).toEqual(Uint8Array.of(7, 8));
    expect(test.controller.workspace).toBe(initial);
    expect(test.network.listener).toBeUndefined();
    expect(test.applicationLifecycle.listener).toBeUndefined();
  });

  it("refreshes authorization through the same replacement and cleanup interface", async () => {
    const initial = workspace("CURRENT", "old");
    const test = harness(initial);
    const refreshed = workspace("CURRENT", "authorized");
    test.refresh.mockResolvedValue(refreshed);
    test.controller.start();

    await test.controller.refreshAuthorization();

    expect(test.controller.workspace).toBe(refreshed);
    expect(initial.userRootKey).toEqual(Uint8Array.of(0, 0));
  });
});
