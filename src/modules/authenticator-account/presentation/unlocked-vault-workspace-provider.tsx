"use client";

import { createContext, type Dispatch, type ReactNode, type SetStateAction, useCallback, useContext, useEffect, useRef, useState } from "react";
import { browserVaultLockPort, nextOfflineSyncState } from "@/modules/sync";
import { BrowserApiError } from "@/shared/infrastructure/browser-api-client";
import { setBrowserWritesReadOnly } from "@/shared/infrastructure/browser-write-policy";
import { clearUnlockedVaultWorkspace, LocalStorageSyncError, refreshUnlockedVaultWorkspace, type UnlockedVaultWorkspace } from "../infrastructure/browser-vault-workspace";
import { browserApplicationLifecycle, browserNetworkStatus } from "@/shared/infrastructure/browser-platform-ports";

type UnlockedVaultWorkspaceSession = {
  workspace: UnlockedVaultWorkspace | null;
  setWorkspace: Dispatch<SetStateAction<UnlockedVaultWorkspace | null>>;
  lockWorkspace: () => void;
  refreshWorkspaceAuthorization: () => Promise<void>;
};

const WorkspaceContext = createContext<UnlockedVaultWorkspaceSession | null>(null);

export function UnlockedVaultWorkspaceProvider({
  children,
  initialWorkspace = null
}: {
  children?: ReactNode;
  initialWorkspace?: UnlockedVaultWorkspace | null;
}) {
  const [workspace, setWorkspaceState] = useState<UnlockedVaultWorkspace | null>(initialWorkspace);
  const workspaceRef = useRef(workspace);
  const lastClearedWorkspaceRef = useRef<UnlockedVaultWorkspace | null>(null);
  const reconcilingRef = useRef(false);
  useEffect(() => { workspaceRef.current = workspace; }, [workspace]);
  useEffect(() => () => {
    clearUnlockedVaultWorkspace(workspaceRef.current);
    workspaceRef.current = null;
  }, []);

  const setWorkspace: Dispatch<SetStateAction<UnlockedVaultWorkspace | null>> = useCallback((update) => {
    setWorkspaceState((current) => {
      const next = typeof update === "function" ? update(current) : update;
      if (current && next === null) {
        clearUnlockedVaultWorkspace(current);
        lastClearedWorkspaceRef.current = current;
      }
      return next;
    });
  }, []);

  const lockWorkspace = useCallback(() => setWorkspace(null), [setWorkspace]);
  const refreshWorkspaceAuthorization = useCallback(async () => {
    const current = workspaceRef.current;
    if (!current) return;
    const key = current.userRootKey.slice();
    try {
      const refreshed = await refreshUnlockedVaultWorkspace(key, current.profileId);
      setWorkspaceState((value) => {
        if (value) clearUnlockedVaultWorkspace(value);
        return refreshed;
      });
    } finally {
      key.fill(0);
    }
  }, []);
  useEffect(() => browserVaultLockPort.subscribe(lockWorkspace), [lockWorkspace]);
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_E2E_BROWSER_TESTS !== "1") return;
    const target = window as typeof window & { __RHSIA_E2E_WORKSPACE_STATE__?: () => unknown };
    target.__RHSIA_E2E_WORKSPACE_STATE__ = () => ({
      workspacePresent: workspaceRef.current !== null,
      lastClearedAllZero: lastClearedWorkspaceRef.current ? workspaceKeyMaterialIsCleared(lastClearedWorkspaceRef.current) : null,
      activeKeyMaterial: workspaceRef.current ? workspaceKeyMaterial(workspaceRef.current).map(bytesToBase64) : []
    });
    return () => { delete target.__RHSIA_E2E_WORKSPACE_STATE__; };
  }, []);

  useEffect(() => {
    setBrowserWritesReadOnly(workspace && workspace.syncState !== "CURRENT" ? `Vault workspace is ${workspace.syncState.toLowerCase()}.` : null);
    return () => setBrowserWritesReadOnly(null);
  }, [workspace]);

  useEffect(() => {
    let active = true;

    const networkLost = () => {
      if (!active) return;
      setWorkspaceState((current) => current ? { ...current, syncState: nextOfflineSyncState(current.syncState, "NETWORK_LOST") } : current);
    };

    const reconcile = async () => {
      const current = workspaceRef.current;
      if (!active || reconcilingRef.current || !browserNetworkStatus.isOnline() || !current || current.syncState === "CURRENT" || current.syncState === "SYNCING") return;
      reconcilingRef.current = true;
      const key = current.userRootKey.slice();
      setWorkspaceState((value) => value ? { ...value, syncState: nextOfflineSyncState(value.syncState, "RECONNECT_STARTED") } : value);
      try {
        const refreshed = await refreshUnlockedVaultWorkspace(key, current.profileId);
        key.fill(0);
        if (!active) { clearUnlockedVaultWorkspace(refreshed); return; }
        setWorkspaceState((value) => {
          if (value) clearUnlockedVaultWorkspace(value);
          return { ...refreshed, syncState: nextOfflineSyncState("SYNCING", "SYNC_SUCCEEDED") };
        });
      } catch (error) {
        key.fill(0);
        if (!active) return;
        const event = error instanceof BrowserApiError && error.status === 401 ? "AUTHENTICATION_FAILED" : error instanceof LocalStorageSyncError ? "LOCAL_STORAGE_FAILED" : "SYNC_FAILED";
        setWorkspaceState((value) => value ? { ...value, syncState: nextOfflineSyncState(value.syncState, event) } : value);
      } finally {
        reconcilingRef.current = false;
      }
    };

    const disposeNetwork = browserNetworkStatus.subscribe((online) => { if (online) void reconcile(); else networkLost(); });
    const disposeVisibility = browserApplicationLifecycle.subscribeVisibility((visible) => { if (visible) void reconcile(); });
    if (!browserNetworkStatus.isOnline()) networkLost();
    return () => {
      active = false;
      disposeNetwork();
      disposeVisibility();
    };
  }, []);

  return <WorkspaceContext value={{ workspace, setWorkspace, lockWorkspace, refreshWorkspaceAuthorization }}>{children}</WorkspaceContext>;
}

function workspaceKeyMaterialIsCleared(workspace: UnlockedVaultWorkspace): boolean {
  return workspaceKeyMaterial(workspace).every((value) => value.every((byte) => byte === 0));
}

function workspaceKeyMaterial(workspace: UnlockedVaultWorkspace): Uint8Array[] {
  return [workspace.userRootKey, ...workspace.vaults.map((vault) => vault.key), ...workspace.accounts.map((account) => account.secret)];
}

function bytesToBase64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}

export function useUnlockedVaultWorkspace(): UnlockedVaultWorkspaceSession {
  const session = useContext(WorkspaceContext);
  if (!session) throw new Error("UnlockedVaultWorkspaceProvider is required.");
  return session;
}
