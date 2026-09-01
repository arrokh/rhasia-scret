import { AppState } from "react-native";
import {
  AuthorizedOfflineBundleTransportError,
  WorkspaceLifecycleCancelledError,
  type ApplicationLifecyclePort,
  type CancellationPort,
  type NetworkStatusPort,
  type PortDisposer,
  type UnlockedVaultWorkspace,
  type WorkspaceLifecycleLockPort,
  type WorkspaceLifecyclePorts,
  type WorkspaceRefreshFailure,
  type WorkspaceWriteGatePort,
} from "@rhasia-scret/client-vault-core";
import type { AuthenticatedTransport } from "@rhasia-scret/client-vault-core";
import {
  clearUnlockedVaultWorkspace,
  nativeNetworkStatus,
  refreshMobileVaultWorkspaceWithKey,
} from "./mobile-vault-workspace";

type NativeAppState = {
  readonly currentState: string;
  addEventListener(type: "change", listener: (state: string) => void): { remove(): void };
};

export class NativeVaultLockPort implements WorkspaceLifecycleLockPort {
  private readonly listeners = new Set<() => void>();

  public subscribe(listener: () => void): PortDisposer {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public requestLock(): void {
    for (const listener of this.listeners) listener();
  }
}

export class NativeApplicationLifecycle implements ApplicationLifecyclePort {
  public constructor(
    private readonly lock: NativeVaultLockPort,
    private readonly appState: NativeAppState = AppState,
  ) {}

  public isVisible(): boolean {
    return this.appState.currentState === "active";
  }

  public subscribeVisibility(listener: (visible: boolean) => void): PortDisposer {
    const subscription = this.appState.addEventListener("change", (state) => {
      const visible = state === "active";
      if (!visible) this.lock.requestLock();
      listener(visible);
    });
    return () => subscription.remove();
  }
}

export class NativeWorkspaceWriteGate implements WorkspaceWriteGatePort {
  private reason: string | null = null;

  public setReadOnly(reason: string | null): void {
    this.reason = reason;
  }

  public get readOnlyReason(): string | null {
    return this.reason;
  }

  public assertWritable(): void {
    if (this.reason) throw new Error(this.reason);
  }
}

export const nativeVaultLockPort = new NativeVaultLockPort();
export const nativeApplicationLifecycle = new NativeApplicationLifecycle(nativeVaultLockPort);
export const nativeWorkspaceWriteGate = new NativeWorkspaceWriteGate();

export function createNativeWorkspaceLifecyclePorts(
  transport: AuthenticatedTransport,
  adapters: Partial<{
    network: NetworkStatusPort;
    applicationLifecycle: ApplicationLifecyclePort;
    lock: WorkspaceLifecycleLockPort;
    writes: WorkspaceWriteGatePort;
  }> = {},
): WorkspaceLifecyclePorts<UnlockedVaultWorkspace> {
  return {
    network: adapters.network ?? nativeNetworkStatus,
    applicationLifecycle: adapters.applicationLifecycle ?? nativeApplicationLifecycle,
    lock: adapters.lock ?? nativeVaultLockPort,
    writes: adapters.writes ?? nativeWorkspaceWriteGate,
    workspace: {
      refresh: (userRootKey, profileId, cancellation) => refreshNativeWorkspace(userRootKey, profileId, cancellation, transport),
      clear: clearUnlockedVaultWorkspace,
      classifyFailure: classifyNativeWorkspaceRefreshFailure,
      readOnlyReason: (workspace) => `Vault workspace is ${workspace.syncState.toLowerCase()}.`,
    },
  };
}

export function classifyNativeWorkspaceRefreshFailure(error: unknown): WorkspaceRefreshFailure {
  if (error instanceof AuthorizedOfflineBundleTransportError && error.status === 401) return "AUTHENTICATION";
  if (error instanceof Error && /Native encrypted Vault storage|Local Vault Snapshot/.test(error.message)) return "LOCAL_STORAGE";
  return "SYNC";
}

async function refreshNativeWorkspace(
  userRootKey: Uint8Array,
  profileId: string,
  cancellation: CancellationPort,
  transport: AuthenticatedTransport,
): Promise<UnlockedVaultWorkspace> {
  if (cancellation.aborted) throw new WorkspaceLifecycleCancelledError();
  const refreshed = await refreshMobileVaultWorkspaceWithKey(userRootKey, profileId, transport);
  if (!cancellation.aborted) return refreshed;
  clearUnlockedVaultWorkspace(refreshed);
  throw new WorkspaceLifecycleCancelledError();
}
