import type { ResponseCookieStore } from "@api/http/cookies";

export interface SessionTerminator {
  terminateCurrentSession(request: Request, cookies: ResponseCookieStore): Promise<void>;
}

export function signOutCurrentSession(
  sessionTerminator: SessionTerminator,
  request: Request,
  cookies: ResponseCookieStore,
): Promise<void> {
  return sessionTerminator.terminateCurrentSession(request, cookies);
}
