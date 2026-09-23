import { describe, expect, it } from "vitest";
import { AuthorizedWorkspaceTransportError } from "@rhasia-scret/client-vault-core";
import { BrowserApiError } from "@/shared/infrastructure/browser-api-client";
import { classifyBrowserWorkspaceRefreshFailure } from "@/modules/sync/infrastructure/browser-workspace-lifecycle";

describe("classifyBrowserWorkspaceRefreshFailure", () => {
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
    expect(classifyBrowserWorkspaceRefreshFailure(new Error("network unavailable"))).toBe("SYNC");
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
