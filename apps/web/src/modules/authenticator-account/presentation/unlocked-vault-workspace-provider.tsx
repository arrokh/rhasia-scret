"use client";

import { createContext, type Dispatch, type ReactNode, type SetStateAction, useContext, useEffect, useRef } from "react";
import { useWorkspaceLifecycle, type UnlockedVaultWorkspace } from "@/modules/sync";

type UnlockedVaultWorkspaceSession = {
  workspace: UnlockedVaultWorkspace | null;
  setWorkspace: Dispatch<SetStateAction<UnlockedVaultWorkspace | null>>;
  replaceWorkspace: (workspace: UnlockedVaultWorkspace | null) => void;
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
  const workspaceRef = useRef<UnlockedVaultWorkspace | null>(initialWorkspace);
  const lastClearedWorkspaceRef = useRef<UnlockedVaultWorkspace | null>(null);
  const { workspace, setWorkspace, replaceWorkspace, lockWorkspace, refreshWorkspaceAuthorization } = useWorkspaceLifecycle(
    initialWorkspace,
    (cleared) => { lastClearedWorkspaceRef.current = cleared; }
  );
  useEffect(() => { workspaceRef.current = workspace; }, [workspace]);

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

  return <WorkspaceContext value={{ workspace, setWorkspace, replaceWorkspace, lockWorkspace, refreshWorkspaceAuthorization }}>{children}</WorkspaceContext>;
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
