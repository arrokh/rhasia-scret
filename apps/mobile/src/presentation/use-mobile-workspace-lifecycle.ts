import { useCallback, useEffect, useRef, useState } from "react";
import {
  WorkspaceLifecycle,
  type AuthenticatedTransport,
  type UnlockedVaultWorkspace,
  type WorkspaceLifecycleUpdater,
} from "@rhasia-scret/client-vault-core";
import { createNativeWorkspaceLifecyclePorts } from "../infrastructure/mobile-workspace-lifecycle";

export type MobileWorkspaceLifecycle = {
  workspace: UnlockedVaultWorkspace | null;
  setWorkspace(update: WorkspaceLifecycleUpdater<UnlockedVaultWorkspace>): void;
  replaceWorkspace(workspace: UnlockedVaultWorkspace | null): void;
  lockWorkspace(): void;
  refreshWorkspaceAuthorization(): Promise<void>;
};

export function useMobileWorkspaceLifecycle(transport: AuthenticatedTransport): MobileWorkspaceLifecycle {
  const [workspace, setWorkspaceState] = useState<UnlockedVaultWorkspace | null>(null);
  const controllerRef = useRef<WorkspaceLifecycle<UnlockedVaultWorkspace> | null>(null);

  useEffect(() => {
    const controller = new WorkspaceLifecycle(null, createNativeWorkspaceLifecyclePorts(transport));
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe(setWorkspaceState);
    controller.start();
    return () => {
      unsubscribe();
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [transport]);

  const setWorkspace = useCallback((update: WorkspaceLifecycleUpdater<UnlockedVaultWorkspace>) => {
    controllerRef.current?.setWorkspace(update);
  }, []);
  const replaceWorkspace = useCallback((next: UnlockedVaultWorkspace | null) => {
    controllerRef.current?.replaceWorkspace(next);
  }, []);
  const lockWorkspace = useCallback(() => controllerRef.current?.lock(), []);
  const refreshWorkspaceAuthorization = useCallback(async () => {
    await controllerRef.current?.refreshAuthorization();
  }, []);

  return { workspace, setWorkspace, replaceWorkspace, lockWorkspace, refreshWorkspaceAuthorization };
}
