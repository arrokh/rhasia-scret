import { describe, expect, it } from "vitest";
import { AuthorizedOfflineBundleTransportError } from "@rhasia-scret/client-vault-core";
import { BrowserApiError } from "@/shared/infrastructure/browser-api-client";
import { classifyBrowserWorkspaceRefreshFailure } from "@/modules/sync/infrastructure/browser-workspace-lifecycle";

describe("classifyBrowserWorkspaceRefreshFailure", () => {
  it("maps the hosted offline-bundle authentication response to an authentication failure", () => {
    expect(
      classifyBrowserWorkspaceRefreshFailure(new AuthorizedOfflineBundleTransportError(401, "unauthenticated")),
    ).toBe("AUTHENTICATION");
  });

  it("maps forbidden authentication responses and generic failures", () => {
    expect(
      classifyBrowserWorkspaceRefreshFailure(new AuthorizedOfflineBundleTransportError(403, "inactive_user")),
    ).toBe("AUTHENTICATION");
    expect(classifyBrowserWorkspaceRefreshFailure(new BrowserApiError("Request failed.", 401))).toBe("AUTHENTICATION");
    expect(classifyBrowserWorkspaceRefreshFailure(new Error("network unavailable"))).toBe("SYNC");
  });
});
