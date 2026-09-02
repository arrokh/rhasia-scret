/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const analytics = vi.hoisted(() => ({ initializeBrowserAnalytics: vi.fn() }));
vi.mock("@/shared/infrastructure/browser-analytics", () => analytics);
import { BrowserAnalyticsBootstrap } from "@/shared/presentation/browser-analytics-bootstrap";

describe("BrowserAnalyticsBootstrap", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    vi.clearAllMocks();
  });

  it("initializes analytics once when mounted", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(createElement(BrowserAnalyticsBootstrap)));

    expect(analytics.initializeBrowserAnalytics).toHaveBeenCalledOnce();
    expect(container.childElementCount).toBe(0);
  });
});
