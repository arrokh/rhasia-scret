/** @vitest-environment jsdom */

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const callbacks = vi.hoisted(() => ({
  onUnlockComplete: undefined as (() => void) | undefined,
  onShowcaseReady: undefined as (() => void) | undefined,
  onShowcaseTransitionComplete: undefined as (() => void) | undefined,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("next/link", () => ({
  default: ({ children, href }: { children?: ReactNode; href: string }) => createElement("a", { href }, children),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));
vi.mock("@/shared/presentation/app-ui", () => ({ AppFooterContent: () => null }));
vi.mock("@/modules/landing/presentation/landing-journey", () => ({ LandingJourney: () => null }));
vi.mock("@/modules/landing/presentation/landing-header", () => ({ LandingHeader: () => null }));
vi.mock("@/modules/landing/presentation/landing-phone-story", () => ({
  LandingPhoneStoryProvider: ({ children }: { children: ReactNode }) => children,
  useLandingPhoneStory: () => "accounts",
  useLandingPhoneStoryStarted: () => false,
}));
vi.mock("@/modules/landing/presentation/landing-phone-mockup", () => ({
  LandingPhoneMockup: ({ onUnlockComplete }: { onUnlockComplete: () => void }) => {
    callbacks.onUnlockComplete = onUnlockComplete;
    return null;
  },
  LandingDeviceShowcase: ({
    progress,
    onReady,
    onTransitionComplete,
  }: {
    progress: number;
    onReady: () => void;
    onTransitionComplete: () => void;
  }) => {
    callbacks.onShowcaseReady = onReady;
    callbacks.onShowcaseTransitionComplete = onTransitionComplete;
    return createElement("div", { "data-testid": "device-showcase", "data-progress": progress });
  },
}));

import { LandingExperience } from "@/modules/landing/presentation/landing-experience";

describe("LandingExperience showcase readiness", () => {
  let root: Root | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    callbacks.onUnlockComplete = undefined;
    callbacks.onShowcaseReady = undefined;
    callbacks.onShowcaseTransitionComplete = undefined;
    document.body.innerHTML = "";
  });

  it("starts the ready showcase when readiness and PageDown arrive in the same React turn", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(createElement(LandingExperience)));

    const getSceneStep = () => container.querySelector<HTMLElement>("[data-landing-desktop-scene]")?.dataset.sceneStep;
    const pressPageDown = () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true, cancelable: true }));

    await act(async () => pressPageDown());
    expect(getSceneStep()).toBe("unlocking");

    const unlockComplete = callbacks.onUnlockComplete;
    if (!unlockComplete) throw new Error("Expected the mocked phone unlock callback.");
    await act(async () => unlockComplete());
    expect(getSceneStep()).toBe("unlocked");

    const showcaseReady = callbacks.onShowcaseReady;
    if (!showcaseReady) throw new Error("Expected the mocked showcase ready callback.");
    await act(async () => {
      showcaseReady();
      pressPageDown();
    });

    expect(getSceneStep()).toBe("expanding");
    expect(container.querySelector<HTMLElement>('[data-testid="device-showcase"]')?.dataset.progress).toBe("0.5");

    const transitionComplete = callbacks.onShowcaseTransitionComplete;
    if (!transitionComplete) throw new Error("Expected the mocked showcase transition callback.");
    await act(async () => transitionComplete());
    expect(getSceneStep()).toBe("devices");
  });
});
