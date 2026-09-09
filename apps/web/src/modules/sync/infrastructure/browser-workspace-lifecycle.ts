"use client";

import {
  AuthorizedOfflineBundleTransportError,
  type UnlockedVaultWorkspace,
  type WorkspaceLifecyclePorts,
  type WorkspaceRefreshFailure,
} from "@rhasia-scret/client-vault-core";
import { BrowserApiError } from "@/shared/infrastructure/browser-api-client";
import { browserApplicationLifecycle, browserNetworkStatus } from "@/shared/infrastructure/browser-platform-ports";
import { setBrowserWritesReadOnly } from "@/shared/infrastructure/browser-write-policy";
import { browserVaultLockPort } from "./browser-vault-lock";
import {
  clearUnlockedVaultWorkspace,
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
      refresh: (userRootKey, profileId) => refreshUnlockedVaultWorkspace(userRootKey, profileId),
      clear: (workspace) => {
        clearUnlockedVaultWorkspace(workspace);
        if (workspace) onCleared?.(workspace);
      },
      classifyFailure: classifyBrowserWorkspaceRefreshFailure,
      readOnlyReason: (workspace) => `Vault workspace is ${workspace.syncState.toLowerCase()}.`,
    },
  };
}

export function classifyBrowserWorkspaceRefreshFailure(error: unknown): WorkspaceRefreshFailure {
  if (error instanceof AuthorizedOfflineBundleTransportError && error.status === 401) return "AUTHENTICATION";
  if (error instanceof BrowserApiError && error.status === 401) return "AUTHENTICATION";
  if (error instanceof LocalStorageSyncError) return "LOCAL_STORAGE";
  return "SYNC";
}
