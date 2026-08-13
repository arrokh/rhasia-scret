export interface SessionTerminator {
  terminateCurrentSession(): Promise<void>;
}

export function signOutCurrentSession(sessionTerminator: SessionTerminator): Promise<void> {
  return sessionTerminator.terminateCurrentSession();
}
