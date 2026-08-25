"use client";

import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { WorkspaceLifecycle, type UnlockedVaultWorkspace } from "@rhasia-scret/client-vault-core";
import { createBrowserWorkspaceLifecyclePorts } from "../infrastructure/browser-workspace-lifecycle";

export type BrowserWorkspaceLifecycle = {
  workspace: UnlockedVaultWorkspace | null;
  setWorkspace: Dispatch<SetStateAction<UnlockedVaultWorkspace | null>>;
  replaceWorkspace: (workspace: UnlockedVaultWorkspace | null) => void;
  lockWorkspace: () => void;
  refreshWorkspaceAuthorization: () => Promise<void>;
};

export function useWorkspaceLifecycle(
  initialWorkspace: UnlockedVaultWorkspace | null = null,
  onCleared?: (workspace: UnlockedVaultWorkspace) => void
): BrowserWorkspaceLifecycle {
  const [workspace, setWorkspaceState] = useState(initialWorkspace);
  const workspaceRef = useRef(workspace);
  const controllerRef = useRef<WorkspaceLifecycle<UnlockedVaultWorkspace> | null>(null);
  const onClearedRef = useRef(onCleared);
  useEffect(() => { onClearedRef.current = onCleared; }, [onCleared]);

  useEffect(() => {
    const controller = new WorkspaceLifecycle(
      workspaceRef.current,
      createBrowserWorkspaceLifecyclePorts((cleared) => onClearedRef.current?.(cleared))
    );
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe((next) => {
      workspaceRef.current = next;
      setWorkspaceState(next);
    });
    controller.start();
    return () => {
      unsubscribe();
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
      workspaceRef.current = null;
    };
  }, []);

  const setWorkspace: Dispatch<SetStateAction<UnlockedVaultWorkspace | null>> = useCallback((update) => {
    const controller = controllerRef.current;
    if (controller) controller.setWorkspace(update);
    else {
      setWorkspaceState((current) => {
        const next = typeof update === "function" ? update(current) : update;
        workspaceRef.current = next;
        return next;
      });
    }
  }, []);

  const replaceWorkspace = useCallback((next: UnlockedVaultWorkspace | null) => {
    const controller = controllerRef.current;
    if (controller) controller.replaceWorkspace(next);
    else {
      workspaceRef.current = next;
      setWorkspaceState(next);
    }
  }, []);

  const lockWorkspace = useCallback(() => controllerRef.current?.lock(), []);
  const refreshWorkspaceAuthorization = useCallback(async () => {
    await controllerRef.current?.refreshAuthorization();
  }, []);

  return { workspace, setWorkspace, replaceWorkspace, lockWorkspace, refreshWorkspaceAuthorization };
}
