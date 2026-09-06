/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANALYTICS_EVENTS } from "@/shared/infrastructure/browser-analytics-config";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const analytics = vi.hoisted(() => ({ identifyAnalyticsUser: vi.fn(), captureAnalyticsEvent: vi.fn() }));
vi.mock("@/shared/infrastructure/browser-analytics", () => analytics);
vi.mock("@/modules/authenticator-account", () => ({ useUnlockedVaultWorkspace: vi.fn() }));
vi.mock("@/modules/identity", () => ({ LogoutForm: vi.fn() }));
import { PostHogIdentify } from "@/modules/vault-management/presentation/vault-page-account-menu";

describe("PostHogIdentify", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    analytics.identifyAnalyticsUser.mockResolvedValue(true);
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.clearAllMocks();
  });

  it("identifies using the application user's ID and email before capturing the session", async () => {
    await act(async () => root.render(createElement(PostHogIdentify, { userId: "application-user-id", email: "alice@example.test" })));
    expect(analytics.identifyAnalyticsUser).toHaveBeenCalledExactlyOnceWith("application-user-id", "alice@example.test");
    expect(analytics.captureAnalyticsEvent).toHaveBeenCalledExactlyOnceWith(ANALYTICS_EVENTS.authenticationSessionEstablished);
    expect(analytics.identifyAnalyticsUser.mock.invocationCallOrder[0]).toBeLessThan(analytics.captureAnalyticsEvent.mock.invocationCallOrder[0]!);
    expect(container.childElementCount).toBe(0);

    await act(async () => root.render(createElement(PostHogIdentify, { userId: "application-user-id", email: "updated@example.test" })));
    expect(analytics.identifyAnalyticsUser).toHaveBeenLastCalledWith("application-user-id", "updated@example.test");
  });

  it("does not capture an identified session when identification is unavailable", async () => {
    analytics.identifyAnalyticsUser.mockResolvedValue(false);
    await act(async () => root.render(createElement(PostHogIdentify, { userId: "application-user-id", email: "alice@example.test" })));
    expect(analytics.captureAnalyticsEvent).not.toHaveBeenCalled();
  });
});
