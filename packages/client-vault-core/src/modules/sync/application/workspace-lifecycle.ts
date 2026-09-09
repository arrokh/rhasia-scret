import type {
  ApplicationLifecyclePort,
  CancellationPort,
  NetworkStatusPort,
  PortDisposer,
} from "../../../shared/application/platform-ports";
import { nextOfflineSyncState, type OfflineSyncEvent, type OfflineSyncState } from "../domain/offline-sync-state";

export type WorkspaceLifecycleValue = {
  profileId: string;
  syncState: OfflineSyncState;
  userRootKey: Uint8Array;
};

export type WorkspaceRefreshFailure = "AUTHENTICATION" | "LOCAL_STORAGE" | "SYNC";

export class WorkspaceLifecycleCancelledError extends Error {
  constructor() {
    super("Workspace refresh was cancelled before it could commit.");
    this.name = "WorkspaceLifecycleCancelledError";
  }
}

export class WorkspaceLifecycleBusyError extends Error {
  constructor() {
    super("Another workspace refresh is already in progress.");
    this.name = "WorkspaceLifecycleBusyError";
  }
}

export interface WorkspaceLifecycleLockPort {
  subscribe(listener: () => void): PortDisposer;
}

export interface WorkspaceWriteGatePort {
  setReadOnly(reason: string | null): void;
}

export interface WorkspaceLifecycleAdapter<Workspace extends WorkspaceLifecycleValue> {
  refresh(userRootKey: Uint8Array, profileId: string, cancellation: CancellationPort): Promise<Workspace>;
  clear(workspace: Workspace | null): void;
  classifyFailure(error: unknown): WorkspaceRefreshFailure;
  readOnlyReason(workspace: Workspace): string;
}

export type WorkspaceLifecyclePorts<Workspace extends WorkspaceLifecycleValue> = {
  network: NetworkStatusPort;
  applicationLifecycle: ApplicationLifecyclePort;
  lock: WorkspaceLifecycleLockPort;
  writes: WorkspaceWriteGatePort;
  workspace: WorkspaceLifecycleAdapter<Workspace>;
};

export type WorkspaceLifecycleListener<Workspace extends WorkspaceLifecycleValue> = (
  workspace: Workspace | null,
) => void;
export type WorkspaceLifecycleUpdater<Workspace extends WorkspaceLifecycleValue> =
  Workspace | null | ((current: Workspace | null) => Workspace | null);

/**
 * Owns the complete unlocked-workspace lifecycle. UI surfaces only adapt its
 * current value to their presentation state; reconciliation, cancellation,
 * write gating, failure transitions, and key clearing stay here.
 */
export class WorkspaceLifecycle<Workspace extends WorkspaceLifecycleValue> {
  private current: Workspace | null;
  private started = false;
  private disposed = false;
  private reconciling: LifecycleCancellation | null = null;
  private readonly listeners = new Set<WorkspaceLifecycleListener<Workspace>>();
  private readonly disposers: PortDisposer[] = [];

  constructor(
    initialWorkspace: Workspace | null,
    private readonly ports: WorkspaceLifecyclePorts<Workspace>,
  ) {
    this.current = initialWorkspace;
  }

  get workspace(): Workspace | null {
    return this.current;
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.disposers.push(
      this.ports.lock.subscribe(() => this.lock()),
      this.ports.network.subscribe((online) => {
        if (online) void this.reconcile();
        else this.markNetworkLost();
      }),
      this.ports.applicationLifecycle.subscribeVisibility((visible) => {
        if (visible) void this.reconcile();
      }),
    );
    if (!this.ports.network.isOnline()) this.markNetworkLost();
    else void this.reconcile();
    this.applyWriteGate();
  }

  subscribe(listener: WorkspaceLifecycleListener<Workspace>): PortDisposer {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  /** Updates presentation-owned workspace data without clearing shared key buffers. */
  setWorkspace(update: WorkspaceLifecycleUpdater<Workspace>): void {
    if (this.disposed) {
      const next = typeof update === "function" ? update(null) : update;
      if (next) this.ports.workspace.clear(next);
      return;
    }
    const next = typeof update === "function" ? update(this.current) : update;
    if (next === this.current) return;
    if (!next) {
      this.lock();
      return;
    }
    this.cancelReconciliation();
    this.current = next;
    this.publish();
    if (this.started && this.ports.network.isOnline()) void this.reconcile();
  }

  /** Replaces cryptographic material and clears the superseded workspace. */
  replaceWorkspace(next: Workspace | null): void {
    if (!next) {
      this.lock();
      return;
    }
    if (this.disposed) {
      this.ports.workspace.clear(next);
      return;
    }
    this.cancelReconciliation();
    const previous = this.current;
    this.current = next;
    if (previous && previous !== next) this.ports.workspace.clear(previous);
    this.publish();
    if (this.started && this.ports.network.isOnline()) void this.reconcile();
  }

  lock(): void {
    this.cancelReconciliation();
    const previous = this.current;
    this.current = null;
    if (previous) this.ports.workspace.clear(previous);
    this.publish();
  }

  async refreshAuthorization(): Promise<void> {
    await this.refresh("authorization");
  }

  async reconcile(): Promise<void> {
    await this.refresh("reconciliation");
  }

  /** Detaches platform listeners while retaining the current workspace. */
  stop(): void {
    if (this.disposed) return;
    this.cancelReconciliation();
    for (const dispose of this.disposers.splice(0)) dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    const previous = this.current;
    this.current = null;
    if (previous) this.ports.workspace.clear(previous);
    this.ports.writes.setReadOnly(null);
    this.listeners.clear();
  }

  private async refresh(mode: "authorization" | "reconciliation"): Promise<void> {
    const source = this.current;
    if (this.reconciling) {
      if (mode === "authorization") throw new WorkspaceLifecycleBusyError();
      return;
    }
    if (
      this.disposed ||
      !source ||
      !this.ports.network.isOnline() ||
      (mode === "reconciliation" && (source.syncState === "CURRENT" || source.syncState === "SYNCING"))
    ) {
      if (mode === "authorization") throw new WorkspaceLifecycleCancelledError();
      return;
    }

    const cancellation = new LifecycleCancellation();
    this.reconciling = cancellation;
    const key = source.userRootKey.slice();
    if (mode === "reconciliation") {
      this.current = { ...source, syncState: nextOfflineSyncState(source.syncState, "RECONNECT_STARTED") };
      this.publish();
    }
    const refreshing = this.current;

    try {
      const refreshed = await this.ports.workspace.refresh(key, source.profileId, cancellation);
      if (cancellation.aborted || this.disposed || this.current !== refreshing) {
        this.ports.workspace.clear(refreshed);
        if (mode === "authorization") throw new WorkspaceLifecycleCancelledError();
        return;
      }
      this.current =
        mode === "reconciliation"
          ? { ...refreshed, syncState: nextOfflineSyncState("SYNCING", "SYNC_SUCCEEDED") }
          : refreshed;
      if (refreshing && refreshing !== this.current) this.ports.workspace.clear(refreshing);
      this.publish();
    } catch (error) {
      if (cancellation.aborted || this.disposed || this.current !== refreshing) {
        if (mode === "authorization")
          throw error instanceof WorkspaceLifecycleCancelledError ? error : new WorkspaceLifecycleCancelledError();
        return;
      }
      if (mode === "reconciliation" && this.current) {
        this.current = {
          ...this.current,
          syncState: nextOfflineSyncState("SYNCING", failureEvent(this.ports.workspace.classifyFailure(error))),
        };
        this.publish();
      }
      if (mode === "authorization") throw error;
    } finally {
      key.fill(0);
      if (this.reconciling === cancellation) this.reconciling = null;
    }
  }

  private markNetworkLost(): void {
    if (this.disposed || !this.current) return;
    this.cancelReconciliation();
    this.current = { ...this.current, syncState: nextOfflineSyncState(this.current.syncState, "NETWORK_LOST") };
    this.publish();
  }

  private cancelReconciliation(): void {
    this.reconciling?.cancel();
    this.reconciling = null;
  }

  private publish(): void {
    this.applyWriteGate();
    for (const listener of this.listeners) listener(this.current);
  }

  private applyWriteGate(): void {
    this.ports.writes.setReadOnly(
      this.current && this.current.syncState !== "CURRENT" ? this.ports.workspace.readOnlyReason(this.current) : null,
    );
  }
}

class LifecycleCancellation implements CancellationPort {
  private cancelled = false;
  private readonly listeners = new Set<() => void>();

  get aborted(): boolean {
    return this.cancelled;
  }

  subscribe(listener: () => void): PortDisposer {
    if (this.cancelled) {
      listener();
      return () => undefined;
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    for (const listener of this.listeners) listener();
    this.listeners.clear();
  }
}

function failureEvent(failure: WorkspaceRefreshFailure): OfflineSyncEvent {
  if (failure === "AUTHENTICATION") return "AUTHENTICATION_FAILED";
  if (failure === "LOCAL_STORAGE") return "LOCAL_STORAGE_FAILED";
  return "SYNC_FAILED";
}
