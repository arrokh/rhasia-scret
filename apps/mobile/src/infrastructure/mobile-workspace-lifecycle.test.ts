import {
  AuthorizedOfflineBundleTransportError,
  WorkspaceLifecycle,
  type ApplicationLifecyclePort,
  type AuthenticatedTransport,
  type NetworkStatusPort,
  type WorkspaceWriteGatePort,
} from "@rhasia-scret/client-vault-core";
import {
  classifyNativeWorkspaceRefreshFailure,
  createNativeWorkspaceLifecyclePorts,
  NativeApplicationLifecycle,
  NativeVaultLockPort,
  NativeWorkspaceWriteGate,
} from "./mobile-workspace-lifecycle";

describe("native WorkspaceLifecycle adapters", () => {
  it("turns backgrounding into an explicit Vault lock signal", () => {
    let appStateListener: ((state: string) => void) | undefined;
    const remove = jest.fn();
    const lock = new NativeVaultLockPort();
    const requested = jest.fn();
    lock.subscribe(requested);
    const lifecycle = new NativeApplicationLifecycle(lock, {
      currentState: "active",
      addEventListener: (_type, listener) => {
        appStateListener = listener;
        return { remove };
      },
    });
    const visibility = jest.fn();
    const removeVisibility = lifecycle.subscribeVisibility(visibility);

    appStateListener?.("background");

    expect(requested).toHaveBeenCalledTimes(1);
    expect(visibility).toHaveBeenCalledWith(false);
    removeVisibility();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("keeps the write-gate reason typed and fail closed", () => {
    const writes = new NativeWorkspaceWriteGate();
    writes.setReadOnly("Vault workspace is offline.");
    expect(writes.readOnlyReason).toBe("Vault workspace is offline.");
    expect(() => writes.assertWritable()).toThrow("offline");
    writes.setReadOnly(null);
    expect(() => writes.assertWritable()).not.toThrow();
  });

  it("creates controller-scoped lock and write-gate adapters", () => {
    const transport: AuthenticatedTransport = {
      request: async () => {
        throw new Error("unused");
      },
    };
    const first = createNativeWorkspaceLifecyclePorts(transport);
    const second = createNativeWorkspaceLifecyclePorts(transport);

    expect(first.network).toBe(second.network);
    expect(first.applicationLifecycle).not.toBe(second.applicationLifecycle);
    expect(first.lock).not.toBe(second.lock);
    expect(first.writes).not.toBe(second.writes);

    const firstLock = jest.fn();
    const secondLock = jest.fn();
    first.lock.subscribe(firstLock);
    second.lock.subscribe(secondLock);
    (first.lock as NativeVaultLockPort).requestLock();
    expect(firstLock).toHaveBeenCalledTimes(1);
    expect(secondLock).not.toHaveBeenCalled();
  });

  it("removes native platform subscriptions when the lifecycle controller is disposed", () => {
    const networkRemove = jest.fn();
    const applicationRemove = jest.fn();
    const network: NetworkStatusPort = { isOnline: () => false, subscribe: () => networkRemove };
    const applicationLifecycle: ApplicationLifecyclePort = {
      isVisible: () => true,
      subscribeVisibility: () => applicationRemove,
    };
    const transport: AuthenticatedTransport = {
      request: async () => {
        throw new Error("unused");
      },
    };
    const controller = new WorkspaceLifecycle(
      null,
      createNativeWorkspaceLifecyclePorts(transport, {
        network,
        applicationLifecycle,
        lock: new NativeVaultLockPort(),
        writes: { setReadOnly: jest.fn() },
      }),
    );

    controller.start();
    controller.dispose();

    expect(networkRemove).toHaveBeenCalledTimes(1);
    expect(applicationRemove).toHaveBeenCalledTimes(1);
  });

  it("composes injected lifecycle ports with the native workspace adapter", () => {
    const network: NetworkStatusPort = { isOnline: () => true, subscribe: () => () => undefined };
    const applicationLifecycle: ApplicationLifecyclePort = {
      isVisible: () => true,
      subscribeVisibility: () => () => undefined,
    };
    const lock = new NativeVaultLockPort();
    const writes: WorkspaceWriteGatePort = { setReadOnly: jest.fn() };
    const transport: AuthenticatedTransport = {
      request: async () => {
        throw new Error("unused");
      },
    };
    const ports = createNativeWorkspaceLifecyclePorts(transport, { network, applicationLifecycle, lock, writes });
    expect(ports).toMatchObject({ network, applicationLifecycle, lock, writes });
  });

  it("classifies authentication, local storage, and synchronization failures", () => {
    expect(
      classifyNativeWorkspaceRefreshFailure(new AuthorizedOfflineBundleTransportError(401, "unauthenticated")),
    ).toBe("AUTHENTICATION");
    expect(classifyNativeWorkspaceRefreshFailure(new Error("Native encrypted Vault storage is invalid."))).toBe(
      "LOCAL_STORAGE",
    );
    expect(classifyNativeWorkspaceRefreshFailure(new Error("network unavailable"))).toBe("SYNC");
  });
});
