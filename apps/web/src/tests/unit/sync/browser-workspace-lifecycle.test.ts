import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthorizedWorkspaceTransportError, WorkspacePrincipalMismatchError } from "@rhasia-scret/client-vault-core";
import { BrowserApiError } from "@/shared/infrastructure/browser-api-client";
import {
  classifyBrowserWorkspaceRefreshFailure,
  createBrowserWorkspaceLifecyclePorts,
} from "@/modules/sync/infrastructure/browser-workspace-lifecycle";
import * as browserVaultLock from "@/modules/sync/infrastructure/browser-vault-lock";

afterEach(() => vi.restoreAllMocks());

describe("classifyBrowserWorkspaceRefreshFailure", () => {
  it("maps a refreshed workspace for another principal to an authentication failure", () => {
    expect(classifyBrowserWorkspaceRefreshFailure(new WorkspacePrincipalMismatchError())).toBe("AUTHENTICATION");
  });

  it("maps the hosted workspace authentication response to an authentication failure", () => {
    expect(classifyBrowserWorkspaceRefreshFailure(new AuthorizedWorkspaceTransportError(401, "unauthenticated"))).toBe(
      "AUTHENTICATION",
    );
  });

  it("maps forbidden authentication responses and generic failures", () => {
    expect(classifyBrowserWorkspaceRefreshFailure(new AuthorizedWorkspaceTransportError(403, "inactive_user"))).toBe(
      "AUTHENTICATION",
    );
    expect(classifyBrowserWorkspaceRefreshFailure(new BrowserApiError("Request failed.", 401))).toBe("AUTHENTICATION");
    expect(classifyBrowserWorkspaceRefreshFailure(new BrowserApiError("Request failed.", 403))).toBe("SYNC");
    expect(classifyBrowserWorkspaceRefreshFailure(new BrowserApiError("Request failed.", 403, "inactive_user"))).toBe(
      "AUTHENTICATION",
    );
    expect(classifyBrowserWorkspaceRefreshFailure(new Error("network unavailable"))).toBe("SYNC");
  });

  it("announces authentication failures across tabs to clear account-scoped Query state", () => {
    const announce = vi.spyOn(browserVaultLock, "announceVaultSessionChange").mockImplementation(() => undefined);
    const ports = createBrowserWorkspaceLifecyclePorts();

    expect(ports.workspace.classifyFailure(new WorkspacePrincipalMismatchError())).toBe("AUTHENTICATION");
    expect(announce).not.toHaveBeenCalled();
    ports.workspace.onAuthenticationFailure?.();
    expect(announce).toHaveBeenCalledOnce();
    expect(ports.workspace.classifyFailure(new Error("temporary network failure"))).toBe("SYNC");
    expect(announce).toHaveBeenCalledOnce();
  });

  it("treats Shared-specific denial, malformed responses, and timeouts as synchronization failures", () => {
    expect(
      classifyBrowserWorkspaceRefreshFailure(new AuthorizedWorkspaceTransportError(403, "membership_revoked")),
    ).toBe("SYNC");
    expect(classifyBrowserWorkspaceRefreshFailure(new Error("malformed workspace response"))).toBe("SYNC");
    const timeout = new Error("workspace request timed out");
    timeout.name = "AbortError";
    expect(classifyBrowserWorkspaceRefreshFailure(timeout)).toBe("SYNC");
  });
});
