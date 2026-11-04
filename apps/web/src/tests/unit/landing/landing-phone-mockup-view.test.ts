/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LandingPhoneMockup, type LandingPhoneView } from "@/modules/landing/presentation/landing-phone-mockup";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("next/dynamic", async () => {
  const { createElement: makeElement } = await import("react");
  return {
    default: () =>
      function MockHostedScreen({ view }: { view: string }) {
        return makeElement("div", { "data-landing-phone-target": view });
      },
  };
});
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/modules/landing/presentation/landing-vaults-home-preview", async () => {
  const { createElement: makeElement } = await import("react");
  return {
    LandingVaultsHomePreview: () => makeElement("div", { "data-landing-vaults-home-preview": "" }),
  };
});
vi.mock("three", () => ({}));
vi.mock("three/addons/renderers/CSS3DRenderer.js", () => ({}));
vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    setMeshoptDecoder(_decoder: unknown) {
      return this;
    }
    loadAsync() {
      return Promise.reject(new Error("Synthetic model-load failure for the fallback rendering test."));
    }
  },
}));
vi.mock("three/addons/libs/meshopt_decoder.module.js", () => ({
  MeshoptDecoder: { ready: Promise.resolve() },
}));

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function render(view: LandingPhoneView) {
  await act(async () => {
    root?.render(createElement(LandingPhoneMockup, { view, layout: "scene" }));
  });
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  vi.restoreAllMocks();
});

describe("LandingPhoneMockup screen transitions", () => {
  it("keeps the accounts workspace mounted and replaces the single active hosted screen", async () => {
    const testContainer = document.createElement("div");
    container = testContainer;
    document.body.append(testContainer);
    root = createRoot(testContainer);

    await render("accounts");
    await act(async () => {
      await vi.waitFor(() =>
        expect(testContainer.querySelector('[data-landing-phone-screen="accounts"]')).not.toBeNull(),
      );
    });

    const screenStack = testContainer.querySelector<HTMLElement>("[data-landing-phone-screen-stack]");
    const accountsLayer = testContainer.querySelector<HTMLElement>('[data-landing-phone-screen="accounts"]');
    const accountsPreview = testContainer.querySelector<HTMLElement>("[data-landing-vaults-home-preview]");
    expect(screenStack).not.toBeNull();
    expect(accountsLayer).not.toBeNull();
    expect(accountsPreview).not.toBeNull();
    expect(
      testContainer.querySelector("[data-landing-phone-fallback-frame][data-landing-phone-body-bounds]"),
    ).not.toBeNull();
    if (!screenStack || !accountsLayer || !accountsPreview) {
      throw new Error("The accounts preview should be rendered in the phone screen stack.");
    }
    expect(accountsLayer.parentElement).toBe(screenStack);

    await render("scan");
    const scanEntry = testContainer.querySelector<HTMLElement>('[data-landing-phone-screen-entry="scan"]');
    expect(accountsLayer).toBe(testContainer.querySelector('[data-landing-phone-screen="accounts"]'));
    expect(accountsPreview).toBe(testContainer.querySelector("[data-landing-vaults-home-preview]"));
    expect(accountsLayer.getAttribute("aria-hidden")).toBe("true");
    expect(accountsLayer.hasAttribute("inert")).toBe(true);
    expect(scanEntry).not.toBeNull();
    expect(scanEntry?.parentElement).toBe(screenStack);
    expect(testContainer.querySelectorAll("[data-landing-phone-target]")).toHaveLength(1);
    expect(testContainer.querySelector('[data-landing-phone-target="scan"]')).not.toBeNull();

    await render("review");
    const reviewEntry = testContainer.querySelector<HTMLElement>('[data-landing-phone-screen-entry="review"]');
    expect(reviewEntry).not.toBeNull();
    expect(reviewEntry).not.toBe(scanEntry);
    expect(reviewEntry?.parentElement).toBe(screenStack);
    expect(accountsLayer).toBe(testContainer.querySelector('[data-landing-phone-screen="accounts"]'));
    expect(accountsPreview).toBe(testContainer.querySelector("[data-landing-vaults-home-preview]"));
    expect(testContainer.querySelectorAll("[data-landing-phone-screen-entry]")).toHaveLength(1);
    expect(testContainer.querySelectorAll("[data-landing-phone-target]")).toHaveLength(1);
    expect(testContainer.querySelector('[data-landing-phone-target="review"]')).not.toBeNull();
    expect(testContainer.querySelector('[data-landing-phone-target="scan"]')).toBeNull();

    await render("accounts");
    expect(accountsLayer).toBe(testContainer.querySelector('[data-landing-phone-screen="accounts"]'));
    expect(accountsPreview).toBe(testContainer.querySelector("[data-landing-vaults-home-preview]"));
    expect(accountsLayer.getAttribute("aria-hidden")).toBe("false");
    expect(accountsLayer.hasAttribute("inert")).toBe(false);
    expect(testContainer.querySelectorAll("[data-landing-phone-screen-entry]")).toHaveLength(0);
    expect(testContainer.querySelectorAll("[data-landing-phone-target]")).toHaveLength(0);
  });
});
