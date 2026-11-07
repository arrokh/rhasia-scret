/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const analytics = vi.hoisted(() => ({
  initializeBrowserAnalytics: vi.fn(),
  initializeCloudflareWebAnalytics: vi.fn(),
  pathname: "/",
}));
vi.mock("@/shared/infrastructure/browser-analytics", () => analytics);
vi.mock("@/shared/infrastructure/cloudflare-web-analytics", () => analytics);
vi.mock("next/navigation", () => ({ usePathname: () => analytics.pathname }));
import { BrowserAnalyticsBootstrap } from "@/shared/presentation/browser-analytics-bootstrap";

const configuration = {
  cloudflareWebAnalyticsToken: "synthetic-cloudflare-analytics-token",
  posthogProjectToken: "synthetic-posthog-project-token",
  posthogHost: "https://analytics.example.invalid",
};

describe("BrowserAnalyticsBootstrap", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    vi.clearAllMocks();
  });

  it("initializes analytics once on a public route", async () => {
    analytics.pathname = "/landing";
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(createElement(BrowserAnalyticsBootstrap, { configuration })));

    expect(analytics.initializeBrowserAnalytics).toHaveBeenCalledOnce();
    expect(analytics.initializeBrowserAnalytics).toHaveBeenCalledWith(configuration);
    expect(analytics.initializeCloudflareWebAnalytics).toHaveBeenCalledOnce();
    expect(analytics.initializeCloudflareWebAnalytics).toHaveBeenCalledWith(configuration.cloudflareWebAnalyticsToken);
    expect(container.childElementCount).toBe(0);
  });

  it("does not initialize analytics on an application route", async () => {
    analytics.pathname = "/vaults/accounts/example";
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(createElement(BrowserAnalyticsBootstrap, { configuration })));

    expect(analytics.initializeBrowserAnalytics).not.toHaveBeenCalled();
    expect(analytics.initializeCloudflareWebAnalytics).not.toHaveBeenCalled();
  });
});
