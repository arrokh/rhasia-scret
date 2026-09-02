import {
  AuthorizedOfflineBundleTransportError,
  type ApplicationLifecyclePort,
  type AuthenticatedTransport,
  type NetworkStatusPort,
  type WorkspaceLifecycleLockPort,
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
    const lock = new NativeVaultLockPort();
    const requested = jest.fn();
    lock.subscribe(requested);
    const lifecycle = new NativeApplicationLifecycle(lock, {
      currentState: "active",
      addEventListener: (_type, listener) => {
        appStateListener = listener;
        return { remove: jest.fn() };
      },
    });
    const visibility = jest.fn();
    lifecycle.subscribeVisibility(visibility);

    appStateListener?.("background");

    expect(requested).toHaveBeenCalledTimes(1);
    expect(visibility).toHaveBeenCalledWith(false);
  });

  it("keeps the write-gate reason typed and fail closed", () => {
    const writes = new NativeWorkspaceWriteGate();
    writes.setReadOnly("Vault workspace is offline.");
    expect(writes.readOnlyReason).toBe("Vault workspace is offline.");
    expect(() => writes.assertWritable()).toThrow("offline");
    writes.setReadOnly(null);
    expect(() => writes.assertWritable()).not.toThrow();
  });

  it("composes injected lifecycle ports with the native workspace adapter", () => {
    const network: NetworkStatusPort = { isOnline: () => true, subscribe: () => () => undefined };
    const applicationLifecycle: ApplicationLifecyclePort = { isVisible: () => true, subscribeVisibility: () => () => undefined };
    const lock: WorkspaceLifecycleLockPort = { subscribe: () => () => undefined };
    const writes: WorkspaceWriteGatePort = { setReadOnly: jest.fn() };
    const transport: AuthenticatedTransport = { request: async () => { throw new Error("unused"); } };
    const ports = createNativeWorkspaceLifecyclePorts(transport, { network, applicationLifecycle, lock, writes });
    expect(ports).toMatchObject({ network, applicationLifecycle, lock, writes });
  });

  it("classifies authentication, local storage, and synchronization failures", () => {
    expect(classifyNativeWorkspaceRefreshFailure(new AuthorizedOfflineBundleTransportError(401, "unauthenticated"))).toBe("AUTHENTICATION");
    expect(classifyNativeWorkspaceRefreshFailure(new Error("Native encrypted Vault storage is invalid."))).toBe("LOCAL_STORAGE");
    expect(classifyNativeWorkspaceRefreshFailure(new Error("network unavailable"))).toBe("SYNC");
  });
});
