"use client";

import { createContext, type Dispatch, type ReactNode, type SetStateAction, useContext, useState } from "react";
import type { UnlockedVaultWorkspace } from "../infrastructure/browser-vault-workspace";

type UnlockedVaultWorkspaceSession = {
  workspace: UnlockedVaultWorkspace | null;
  setWorkspace: Dispatch<SetStateAction<UnlockedVaultWorkspace | null>>;
};

const WorkspaceContext = createContext<UnlockedVaultWorkspaceSession | null>(null);

export function UnlockedVaultWorkspaceProvider({
  children,
  initialWorkspace = null
}: {
  children?: ReactNode;
  initialWorkspace?: UnlockedVaultWorkspace | null;
}) {
  const [workspace, setWorkspace] = useState<UnlockedVaultWorkspace | null>(initialWorkspace);
  return <WorkspaceContext value={{ workspace, setWorkspace }}>{children}</WorkspaceContext>;
}

export function useUnlockedVaultWorkspace(): UnlockedVaultWorkspaceSession {
  const session = useContext(WorkspaceContext);
  if (!session) throw new Error("UnlockedVaultWorkspaceProvider is required.");
  return session;
}
