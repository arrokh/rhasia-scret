"use client";

import {
  AuthorizedWorkspaceTransportError,
  WorkspacePrincipalMismatchError,
  type UnlockedVaultWorkspace,
  type WorkspaceLifecyclePorts,
  type WorkspaceRefreshFailure,
} from "@rhasia-scret/client-vault-core";
import { BrowserApiError } from "@/shared/infrastructure/browser-api-client";
import { browserApplicationLifecycle, browserNetworkStatus } from "@/shared/infrastructure/browser-platform-ports";
import { setBrowserWritesReadOnly } from "@/shared/infrastructure/browser-write-policy";
import { announceVaultSessionChange, browserVaultLockPort } from "./browser-vault-lock";
import {
  clearUnlockedVaultWorkspace,
  evictSharedVaultWorkspace,
  LocalStorageSyncError,
  refreshUnlockedVaultWorkspace,
} from "./browser-vault-workspace";

export function createBrowserWorkspaceLifecyclePorts(
  onCleared?: (workspace: UnlockedVaultWorkspace) => void,
): WorkspaceLifecyclePorts<UnlockedVaultWorkspace> {
  return {
    network: browserNetworkStatus,
    applicationLifecycle: browserApplicationLifecycle,
    lock: browserVaultLockPort,
    writes: { setReadOnly: setBrowserWritesReadOnly },
    workspace: {
      refresh: (userRootKey, profileId, cancellation) =>
        refreshUnlockedVaultWorkspace(userRootKey, profileId, cancellation),
      clear: (workspace) => {
        clearUnlockedVaultWorkspace(workspace);
        if (workspace) onCleared?.(workspace);
      },
      evictShared: evictSharedVaultWorkspace,
      classifyFailure: classifyBrowserWorkspaceRefreshFailure,
      onAuthenticationFailure: announceVaultSessionChange,
      readOnlyReason: (workspace) => `Vault workspace is ${workspace.syncState.toLowerCase()}.`,
    },
  };
}

export function classifyBrowserWorkspaceRefreshFailure(error: unknown): WorkspaceRefreshFailure {
  if (error instanceof WorkspacePrincipalMismatchError) return "AUTHENTICATION";
  if (
    error instanceof AuthorizedWorkspaceTransportError &&
    (error.status === 401 || (error.status === 403 && error.code === "inactive_user"))
  )
    return "AUTHENTICATION";
  if (
    error instanceof BrowserApiError &&
    (error.status === 401 || (error.status === 403 && error.code === "inactive_user"))
  )
    return "AUTHENTICATION";
  if (error instanceof LocalStorageSyncError) return "LOCAL_STORAGE";
  return "SYNC";
}
