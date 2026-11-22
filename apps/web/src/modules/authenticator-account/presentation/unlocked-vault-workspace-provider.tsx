"use client";

import {
  createContext,
  type Dispatch,
  type ReactNode,
  useCallback,
  type SetStateAction,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
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
  initialWorkspace = null,
}: {
  children?: ReactNode;
  initialWorkspace?: UnlockedVaultWorkspace | null;
}) {
  const pathname = usePathname();
  const previousPathnameRef = useRef(pathname);
  const workspaceRef = useRef<UnlockedVaultWorkspace | null>(initialWorkspace);
  const lastClearedWorkspaceRef = useRef<UnlockedVaultWorkspace | null>(null);
  const { workspace, setWorkspace, replaceWorkspace, lockWorkspace, refreshWorkspaceAuthorization } =
    useWorkspaceLifecycle(initialWorkspace, (cleared) => {
      lastClearedWorkspaceRef.current = cleared;
      if (process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_E2E_BROWSER_TESTS !== "1") return;
      const target = window as typeof window & { __RHSIA_E2E_LAST_CLEAR_ALL_ZERO__?: boolean };
      target.__RHSIA_E2E_LAST_CLEAR_ALL_ZERO__ = workspaceKeyMaterialIsCleared(cleared);
    });
  useEffect(() => {
    workspaceRef.current = workspace;
    if (!workspace) return;
    lastClearedWorkspaceRef.current = null;
    if (process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_E2E_BROWSER_TESTS !== "1") return;
    const target = window as typeof window & { __RHSIA_E2E_LAST_CLEAR_ALL_ZERO__?: boolean };
    target.__RHSIA_E2E_LAST_CLEAR_ALL_ZERO__ = undefined;
  }, [workspace]);

  useEffect(() => {
    if (previousPathnameRef.current === pathname) return;
    previousPathnameRef.current = pathname;
    void refreshWorkspaceAuthorization().catch(() => undefined);
  }, [pathname, refreshWorkspaceAuthorization]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_E2E_BROWSER_TESTS !== "1") return;
    const target = window as typeof window & {
      __RHSIA_E2E_LAST_CLEAR_ALL_ZERO__?: boolean;
      __RHSIA_E2E_WORKSPACE_STATE__?: () => unknown;
    };
    target.__RHSIA_E2E_WORKSPACE_STATE__ = () => ({
      workspacePresent: workspaceRef.current !== null,
      lastClearedAllZero: lastClearedWorkspaceRef.current
        ? workspaceKeyMaterialIsCleared(lastClearedWorkspaceRef.current)
        : (target.__RHSIA_E2E_LAST_CLEAR_ALL_ZERO__ ?? null),
      activeKeyMaterialCount: workspaceRef.current ? workspaceKeyMaterial(workspaceRef.current).length : 0,
    });
    return () => {
      delete target.__RHSIA_E2E_WORKSPACE_STATE__;
    };
  }, []);

  return (
    <WorkspaceContext
      value={{ workspace, setWorkspace, replaceWorkspace, lockWorkspace, refreshWorkspaceAuthorization }}
    >
      {children}
    </WorkspaceContext>
  );
}

/** Provides an in-memory synthetic workspace for read-only product previews. */
export function PreviewUnlockedVaultWorkspaceProvider({
  children,
  initialWorkspace,
}: {
  children?: ReactNode;
  initialWorkspace: UnlockedVaultWorkspace | null;
}) {
  const [workspace, setWorkspace] = useState<UnlockedVaultWorkspace | null>(initialWorkspace);
  const replaceWorkspace = useCallback((next: UnlockedVaultWorkspace | null) => setWorkspace(next), []);
  const lockWorkspace = useCallback(() => setWorkspace(null), []);
  const refreshWorkspaceAuthorization = useCallback(async () => undefined, []);
  const session = useMemo(
    () => ({ workspace, setWorkspace, replaceWorkspace, lockWorkspace, refreshWorkspaceAuthorization }),
    [workspace, replaceWorkspace, lockWorkspace, refreshWorkspaceAuthorization],
  );

  return <WorkspaceContext value={session}>{children}</WorkspaceContext>;
}

function workspaceKeyMaterialIsCleared(workspace: UnlockedVaultWorkspace): boolean {
  return workspaceKeyMaterial(workspace).every((value) => value.every((byte) => byte === 0));
}

function workspaceKeyMaterial(workspace: UnlockedVaultWorkspace): Uint8Array[] {
  return [
    workspace.userRootKey,
    ...workspace.vaults.map((vault) => vault.key),
    ...workspace.accounts.map((account) => account.secret),
  ];
}

export function useUnlockedVaultWorkspace(): UnlockedVaultWorkspaceSession {
  const session = useContext(WorkspaceContext);
  if (!session) throw new Error("UnlockedVaultWorkspaceProvider is required.");
  return session;
}
