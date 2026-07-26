/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const navigation = vi.hoisted(() => ({ pathname: "/vaults", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search)
}));
import { NavigationProgress } from "@/shared/presentation/navigation-progress";

describe("NavigationProgress", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    navigation.pathname = "/vaults";
    navigation.search = "";
    vi.useRealTimers();
  });

  it("shows immediately for an internal page link and remains visible briefly after arrival", async () => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(createElement(NavigationProgress)));

    const link = document.createElement("a");
    link.href = "/vaults/manage";
    container.append(link);
    window.addEventListener("click", (event) => event.preventDefault(), { once: true });
    await act(async () => link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();

    navigation.pathname = "/vaults/manage";
    await act(async () => root?.render(createElement(NavigationProgress)));
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();

    await act(async () => vi.advanceTimersByTimeAsync(350));
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });
});
