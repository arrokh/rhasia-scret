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

  it("retains legacy browser API authentication and generic failure mappings", () => {
    expect(classifyBrowserWorkspaceRefreshFailure(new BrowserApiError("Request failed.", 401))).toBe("AUTHENTICATION");
    expect(classifyBrowserWorkspaceRefreshFailure(new Error("network unavailable"))).toBe("SYNC");
  });
});
