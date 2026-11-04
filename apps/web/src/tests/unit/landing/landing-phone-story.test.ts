/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LandingPhoneStoryProvider,
  useLandingPhoneStory,
  useLandingPhoneStoryStarted,
} from "@/modules/landing/presentation/landing-phone-story";
import { landingFlowConfig } from "@/modules/landing/presentation/landing-flow.config";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type StoryFixture = {
  container: HTMLDivElement;
  heroSection: HTMLElement;
  heroAnchor: HTMLElement;
  journeySection: HTMLElement;
  journeyAnchor: HTMLElement;
  stage: HTMLElement;
};

let root: Root | undefined;
let fixture: StoryFixture | undefined;
const frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;

function installFrameQueue() {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextFrameId++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
}

async function flushAnimationFrames() {
  for (let pass = 0; frames.size > 0 && pass < 5; pass += 1) {
    const pending = [...frames.values()];
    frames.clear();
    await act(async () => {
      for (const callback of pending) callback(performance.now());
    });
  }
}

function makeRect(left: number, top: number, width: number, height: number) {
  return new DOMRect(left, top, width, height);
}

function setRect(element: HTMLElement, rect: () => DOMRect) {
  vi.spyOn(element, "getBoundingClientRect").mockImplementation(rect);
  vi.spyOn(element, "getClientRects").mockReturnValue([makeRect(0, 0, 1, 1)] as unknown as DOMRectList);
}

function getScale(element: HTMLElement) {
  return Number(element.style.transform.match(/scale\(([-+0-9.e]+)\)/)?.[1] ?? 1);
}

function getStageLayout(stage: HTMLElement) {
  return {
    left: Number.parseFloat(stage.style.left) || 0,
    top: Number.parseFloat(stage.style.top) || 0,
    width: Number.parseFloat(stage.style.width) || window.innerWidth,
    height: Number.parseFloat(stage.style.height) || window.innerHeight,
  };
}

function setRenderedStageRect(stage: HTMLElement) {
  setRect(stage, () => {
    const { left, top, width, height } = getStageLayout(stage);
    const scale = getScale(stage);
    return makeRect(left + ((1 - scale) * width) / 2, top + ((1 - scale) * height) / 2, width * scale, height * scale);
  });
}

function setRenderedPhoneFrameRect(frame: HTMLElement, stage: HTMLElement, scene: HTMLElement, initialBounds: DOMRect) {
  setRect(frame, () => {
    const stageBounds = stage.getBoundingClientRect();
    const scale = getScale(stage) * getScale(scene);
    const offsetX = initialBounds.left + initialBounds.width / 2 - window.innerWidth / 2;
    const offsetY = initialBounds.top + initialBounds.height / 2 - window.innerHeight / 2;
    const centerX = stageBounds.left + stageBounds.width / 2 + offsetX * scale;
    const centerY = stageBounds.top + stageBounds.height / 2 + offsetY * scale;
    return makeRect(
      centerX - (initialBounds.width * scale) / 2,
      centerY - (initialBounds.height * scale) / 2,
      initialBounds.width * scale,
      initialBounds.height * scale,
    );
  });
}

function createStoryFixture(): StoryFixture {
  const heroSection = document.createElement("section");
  heroSection.dataset.landingPhoneStoryHero = "";
  heroSection.dataset.sceneStep = "settled";
  heroSection.setAttribute("aria-busy", "false");
  Object.defineProperty(heroSection, "clientHeight", { configurable: true, value: 1000 });

  const heroAnchor = document.createElement("div");
  heroAnchor.dataset.landingPhoneAnchor = "hero";
  setRect(heroSection, () => makeRect(0, -window.scrollY, 1000, 1000));
  setRect(heroAnchor, () => makeRect(100, 400 - window.scrollY, 100, 100));
  heroSection.append(heroAnchor);

  const journeySection = document.createElement("section");
  journeySection.dataset.landingPhoneStoryJourney = "";
  const journeyAnchor = document.createElement("div");
  journeyAnchor.dataset.landingPhoneAnchor = "journey";
  setRect(journeySection, () => makeRect(0, 1000 - window.scrollY, 1000, 2000));
  setRect(journeyAnchor, () => makeRect(800, 1310 - window.scrollY, 200, 200));
  journeySection.append(journeyAnchor);

  const stage = document.createElement("div");
  stage.dataset.landingPrimaryPhone = "";
  stage.dataset.visible = "true";
  const guide = document.createElement("article");
  guide.dataset.landingPhoneGuide = "right";
  guide.dataset.active = "true";
  setRect(guide, () => makeRect(20, 300, 300, 200));

  const container = document.createElement("div");
  document.body.append(heroSection, journeySection, stage, guide, container);
  return { container, heroSection, heroAnchor, journeySection, journeyAnchor, stage };
}

function StoryStateProbe() {
  const view = useLandingPhoneStory();
  const started = useLandingPhoneStoryStarted();
  return createElement("output", {
    "data-story-probe": "true",
    "data-story-view": view,
    "data-story-started": String(started),
  });
}

async function renderStory(withProbe = false) {
  if (!fixture) throw new Error("Landing story fixture is unavailable.");
  root = createRoot(fixture.container);
  await act(async () =>
    root?.render(createElement(LandingPhoneStoryProvider, null, withProbe ? createElement(StoryStateProbe) : null)),
  );
  await flushAnimationFrames();
}

describe("LandingPhoneStoryProvider", () => {
  afterEach(async () => {
    await act(async () => root?.unmount());
    fixture?.container.parentElement?.replaceChildren();
    fixture = undefined;
    root = undefined;
    frames.clear();
    nextFrameId = 1;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
  });

  it.each(["marked", "accounts"])(
    "maps the %s control to the right edge of its visible same-origin phone highlight",
    async (kind) => {
      installFrameQueue();
      Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
      fixture = createStoryFixture();
      setRect(fixture.journeySection, () => makeRect(0, 500 - window.scrollY, 1000, 2000));
      const frame = document.createElement("iframe");
      frame.dataset.deviceKind = "phone";
      frame.dataset.slot = "landing-phone-screen";
      fixture.stage.append(frame);
      const frameDocument = frame.contentDocument;
      const frameWindow = frame.contentWindow;
      if (!frameDocument || !frameWindow) throw new Error("The test phone iframe is unavailable.");
      Object.defineProperty(frameWindow, "innerWidth", { configurable: true, value: 390 });
      Object.defineProperty(frameWindow, "innerHeight", { configurable: true, value: 844 });
      const target = frameDocument.createElement(kind === "accounts" ? "a" : "button");
      if (kind === "accounts") target.setAttribute("href", "/vaults/accounts/new");
      if (kind === "marked") target.dataset.landingPhoneTarget = "scan";
      setRect(target, () => makeRect(100, 200, 80, 40));
      frameDocument.body.append(target);
      setRenderedStageRect(fixture.stage);
      setRenderedPhoneFrameRect(frame, fixture.stage, fixture.stage, makeRect(300, 100, 195, 422));

      await renderStory();

      const connectorPath = fixture.container.querySelector("svg path");
      const connectorDot = fixture.container.querySelector("svg circle");
      const renderedFrame = frame.getBoundingClientRect();
      expect(connectorPath?.getAttribute("d")).toMatch(/^M 40 301 C /);
      expect(connectorPath?.getAttribute("d")).toMatch(/ 792.5 210$/);
      expect(connectorDot?.getAttribute("cx")).toBe("792.5");
      expect(connectorDot?.getAttribute("cy")).toBe("210");

      fixture.stage.style.transform = "scale(0.52)";
      await act(async () => window.dispatchEvent(new Event("resize")));
      await flushAnimationFrames();
      const transformedFrame = frame.getBoundingClientRect();
      expect(Number(connectorDot?.getAttribute("cx"))).toBeCloseTo(
        transformedFrame.left + (185 / 390) * transformedFrame.width,
      );
      expect(Number(connectorDot?.getAttribute("cy"))).toBeCloseTo(
        transformedFrame.top + (220 / 844) * transformedFrame.height,
      );
      expect(renderedFrame.width).toBeCloseTo(195);

      Object.defineProperty(window, "scrollY", { configurable: true, value: 2600 });
      await act(async () => window.dispatchEvent(new Event("scroll")));
      await flushAnimationFrames();
      expect(connectorPath?.getAttribute("d")).toBe("");
      expect(connectorDot?.getAttribute("visibility")).toBe("hidden");

      await act(async () => {
        frameDocument.body.replaceChildren();
        await Promise.resolve();
      });
      await flushAnimationFrames();
      expect(connectorPath?.getAttribute("d")).toBe("");
      expect(connectorDot?.getAttribute("visibility")).toBe("hidden");
    },
  );

  it("ignores hidden and out-of-viewport controls inside the phone screen", async () => {
    installFrameQueue();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
    fixture = createStoryFixture();
    setRect(fixture.journeySection, () => makeRect(0, 500 - window.scrollY, 1000, 2000));
    const frame = document.createElement("iframe");
    frame.dataset.deviceKind = "phone";
    frame.dataset.slot = "landing-phone-screen";
    fixture.stage.append(frame);
    const frameDocument = frame.contentDocument;
    const frameWindow = frame.contentWindow;
    if (!frameDocument || !frameWindow) throw new Error("The test phone iframe is unavailable.");
    Object.defineProperty(frameWindow, "innerWidth", { configurable: true, value: 390 });
    Object.defineProperty(frameWindow, "innerHeight", { configurable: true, value: 844 });

    const hiddenParent = frameDocument.createElement("div");
    hiddenParent.setAttribute("aria-hidden", "true");
    const hiddenTarget = frameDocument.createElement("button");
    hiddenTarget.dataset.landingPhoneTarget = "stale";
    setRect(hiddenTarget, () => makeRect(300, 200, 50, 40));
    hiddenParent.append(hiddenTarget);
    const activeTarget = frameDocument.createElement("button");
    activeTarget.dataset.landingPhoneTarget = "scan";
    setRect(activeTarget, () => makeRect(100, 200, 80, 40));
    let activeTargetLeft = 100;
    vi.spyOn(activeTarget, "getBoundingClientRect").mockImplementation(() => makeRect(activeTargetLeft, 200, 80, 40));
    frameDocument.body.append(hiddenParent, activeTarget);
    setRenderedStageRect(fixture.stage);
    setRenderedPhoneFrameRect(frame, fixture.stage, fixture.stage, makeRect(300, 100, 195, 422));

    await renderStory();

    const connectorPath = fixture.container.querySelector("svg path");
    const connectorDot = fixture.container.querySelector("svg circle");
    const renderedFrame = frame.getBoundingClientRect();
    expect(Number(connectorDot?.getAttribute("cx"))).toBeCloseTo(
      renderedFrame.left + (185 / 390) * renderedFrame.width,
    );
    expect(connectorDot?.getAttribute("visibility")).toBe("visible");

    activeTargetLeft = 410;
    await act(async () => window.dispatchEvent(new Event("resize")));
    await flushAnimationFrames();
    expect(connectorPath?.getAttribute("d")).toBe("");
    expect(connectorDot?.getAttribute("visibility")).toBe("hidden");
  });

  it("routes the mobile connector around the phone and caption to the guide card's top-right inset corner", async () => {
    installFrameQueue();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    fixture = createStoryFixture();
    setRect(fixture.journeySection, () => makeRect(0, -window.scrollY, 1000, 2000));
    setRect(fixture.journeyAnchor, () => makeRect(3, 50 - window.scrollY, 384, 450));

    const mobileGuide = document.createElement("article");
    mobileGuide.dataset.landingPhoneGuide = "mobile";
    mobileGuide.dataset.active = "true";
    setRect(mobileGuide, () => makeRect(16, 500, 358, 280));
    const caption = document.createElement("div");
    caption.dataset.landingPhoneCaption = "";
    setRect(caption, () => makeRect(70, 430, 260, 30));
    document.body.append(mobileGuide, caption);

    const scene = document.createElement("div");
    scene.dataset.layout = "scene";
    const frame = document.createElement("iframe");
    frame.dataset.deviceKind = "phone";
    frame.dataset.slot = "landing-phone-screen";
    scene.append(frame);
    fixture.stage.append(scene);
    const frameDocument = frame.contentDocument;
    const frameWindow = frame.contentWindow;
    if (!frameDocument || !frameWindow) throw new Error("The test phone iframe is unavailable.");
    Object.defineProperty(frameWindow, "innerWidth", { configurable: true, value: 390 });
    Object.defineProperty(frameWindow, "innerHeight", { configurable: true, value: 844 });
    const target = frameDocument.createElement("button");
    target.dataset.landingPhoneTarget = "scan";
    setRect(target, () => makeRect(240, 200, 80, 40));
    frameDocument.body.append(target);
    setRenderedStageRect(fixture.stage);
    setRenderedPhoneFrameRect(frame, fixture.stage, scene, makeRect(65, 150, 260, 560));

    await renderStory();

    const phoneBounds = frame.getBoundingClientRect();
    const captionBounds = caption.getBoundingClientRect();
    const cardBounds = mobileGuide.getBoundingClientRect();
    const connectorPath = fixture.container.querySelector("svg path");
    const connectorDot = fixture.container.querySelector("svg circle");
    const targetX = phoneBounds.left + (325 / 390) * phoneBounds.width;
    const targetY = phoneBounds.top + (220 / 844) * phoneBounds.height;
    const guideX = cardBounds.right - 20;
    const rightExitX = Math.min(
      window.innerWidth - 4,
      Math.max(Math.max(phoneBounds.right, captionBounds.right) + 14, guideX + 16),
    );
    const routeBottom = cardBounds.top - 4;
    const guideNode = fixture.container.querySelector("[data-landing-guide-node]");
    expect(guideNode).not.toBeNull();
    expect(guideNode?.getAttribute("cx")).toBe("354");
    expect(guideNode?.getAttribute("cy")).toBe("501");

    expect(connectorPath?.getAttribute("d")).toMatch(/^M [0-9.]+ [0-9.]+ C [0-9.]+ [0-9.]+/);
    expect(Number(connectorPath?.getAttribute("d")?.split(" ")[1])).toBeCloseTo(targetX);
    expect(connectorPath?.getAttribute("d")).toContain(`C ${rightExitX} `);
    expect(connectorPath?.getAttribute("d")).toContain(`L ${rightExitX} ${routeBottom - 8}`);
    expect(connectorPath?.getAttribute("d")).toContain(`L 362 ${routeBottom}`);
    expect(connectorPath?.getAttribute("d")).toMatch(/Q 354 [^ ]+, 354 501$/);
    expect(rightExitX).toBeGreaterThan(phoneBounds.right);
    expect(routeBottom).toBeGreaterThan(phoneBounds.bottom);
    expect(rightExitX - 8).toBeGreaterThanOrEqual(guideX + 8);
    expect(routeBottom).toBeGreaterThan(captionBounds.bottom);
    expect(routeBottom).toBeLessThan(cardBounds.top);
    expect(Number(connectorDot?.getAttribute("cx"))).toBeCloseTo(targetX);
    expect(Number(connectorDot?.getAttribute("cy"))).toBeCloseTo(targetY);
    expect(connectorDot?.getAttribute("visibility")).toBe("visible");
  });

  it("lets the desktop phone leave gradually above the privacy note before hiding and restores it on reverse", async () => {
    installFrameQueue();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
    fixture = createStoryFixture();
    setRect(fixture.journeySection, () => makeRect(0, -window.scrollY, 1000, 2000));
    setRect(fixture.journeyAnchor, () => makeRect(530, 400 - window.scrollY, 200, 200));
    let noteTop = 500;
    const privacyNote = document.createElement("p");
    privacyNote.dataset.landingPhoneStoryEnd = "";
    setRect(privacyNote, () => makeRect(0, noteTop, 1000, 60));
    fixture.journeySection.append(privacyNote);

    const frame = document.createElement("iframe");
    frame.dataset.deviceKind = "phone";
    frame.dataset.slot = "landing-phone-screen";
    fixture.stage.append(frame);
    setRenderedStageRect(fixture.stage);
    setRenderedPhoneFrameRect(frame, fixture.stage, fixture.stage, makeRect(300, 100, 195, 422));
    const body = document.createElement("div");
    body.dataset.landingPhoneBodyBounds = "";
    fixture.stage.append(body);
    setRenderedPhoneFrameRect(body, fixture.stage, fixture.stage, makeRect(290, 80, 215, 462));

    await renderStory();

    expect(noteTop - body.getBoundingClientRect().bottom).toBeCloseTo(24);
    const clampedBounds = frame.getBoundingClientRect();
    expect(fixture.stage.style.visibility).toBe("");
    expect(clampedBounds.bottom).toBeLessThanOrEqual(noteTop - Math.max(18, clampedBounds.height * 0.06) + 1);
    expect(clampedBounds.top).toBeGreaterThanOrEqual(8);

    noteTop = 400;
    await act(async () => window.dispatchEvent(new Event("scroll")));
    await flushAnimationFrames();
    expect(fixture.stage.style.visibility).toBe("");
    expect(frame.getBoundingClientRect().top).toBeLessThan(0);
    expect(frame.getBoundingClientRect().bottom).toBeLessThanOrEqual(noteTop - 422 * 0.06 + 1);
    expect(noteTop - body.getBoundingClientRect().bottom).toBeCloseTo(24);

    noteTop = 20;
    await act(async () => window.dispatchEvent(new Event("scroll")));
    await flushAnimationFrames();
    expect(fixture.stage.style.visibility).toBe("hidden");

    noteTop = 500;
    await act(async () => window.dispatchEvent(new Event("scroll")));
    await flushAnimationFrames();
    expect(fixture.stage.style.visibility).toBe("");
    expect(frame.getBoundingClientRect().top).toBeGreaterThanOrEqual(8);
  });

  it("keeps the same footer gap for the fallback phone without a CSS3D screen", async () => {
    installFrameQueue();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
    fixture = createStoryFixture();
    setRect(fixture.journeySection, () => makeRect(0, 0, 1000, 2000));
    setRect(fixture.journeyAnchor, () => makeRect(530, 400, 200, 200));
    const privacyNote = document.createElement("p");
    privacyNote.dataset.landingPhoneStoryEnd = "";
    setRect(privacyNote, () => makeRect(0, 500, 1000, 60));
    fixture.journeySection.append(privacyNote);
    const body = document.createElement("div");
    body.dataset.landingPhoneBodyBounds = "";
    body.dataset.landingPhoneFallbackFrame = "";
    fixture.stage.append(body);
    setRenderedStageRect(fixture.stage);
    setRenderedPhoneFrameRect(body, fixture.stage, fixture.stage, makeRect(300, 100, 195, 422));

    await renderStory();

    expect(fixture.stage.style.visibility).toBe("");
    expect(500 - body.getBoundingClientRect().bottom).toBeCloseTo(24);
  });

  it("selects all eight phone views from their real journey-card sequence", async () => {
    installFrameQueue();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
    fixture = createStoryFixture();
    setRect(fixture.journeySection, () => makeRect(0, -window.scrollY, 1000, 2000));
    let activeIndex = 0;
    const cards = landingFlowConfig.journey.steps.map((step, index) => {
      const card = document.createElement("article");
      card.dataset.landingPhoneView = step.phoneView;
      setRect(card, () => makeRect(300, 500 + (index - activeIndex) * 2000, 300, 100));
      fixture?.journeySection.append(card);
      return card;
    });

    await renderStory(true);

    const probe = fixture.container.querySelector<HTMLOutputElement>("[data-story-probe]");
    expect(cards).toHaveLength(8);
    expect(probe?.dataset.storyView).toBe("accounts");
    for (const [index, step] of landingFlowConfig.journey.steps.entries()) {
      activeIndex = index;
      await act(async () => window.dispatchEvent(new Event("scroll")));
      await flushAnimationFrames();
      expect(probe?.dataset.storyView).toBe(step.phoneView);
    }
  });

  it("selects the visible responsive journey anchor after a viewport change", async () => {
    installFrameQueue();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
    fixture = createStoryFixture();
    let desktopAnchorVisible = true;
    let mobileAnchorVisible = false;
    vi.spyOn(fixture.journeyAnchor, "getClientRects").mockImplementation(() =>
      desktopAnchorVisible ? ([makeRect(0, 0, 1, 1)] as unknown as DOMRectList) : ([] as unknown as DOMRectList),
    );
    const mobileAnchor = document.createElement("div");
    mobileAnchor.dataset.landingPhoneAnchor = "journey";
    setRect(mobileAnchor, () => makeRect(700, 180, 200, 200));
    vi.spyOn(mobileAnchor, "getClientRects").mockImplementation(() =>
      mobileAnchorVisible ? ([makeRect(0, 0, 1, 1)] as unknown as DOMRectList) : ([] as unknown as DOMRectList),
    );
    fixture.journeySection.append(mobileAnchor);
    await renderStory();

    desktopAnchorVisible = false;
    mobileAnchorVisible = true;
    Object.defineProperty(window, "scrollY", { configurable: true, value: 1500 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    await act(async () => window.dispatchEvent(new Event("resize")));
    await flushAnimationFrames();

    expect(fixture.stage.style.left).toBe("605px");
    expect(fixture.stage.style.top).toBe("0px");
  });

  it("starts on card 01, follows the real journey cards, and restores the phone on reverse scroll", async () => {
    installFrameQueue();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
    fixture = createStoryFixture();
    setRect(fixture.journeySection, () => makeRect(0, -window.scrollY, 1000, 2000));
    setRect(fixture.journeyAnchor, () => makeRect(530, 400 - window.scrollY, 200, 200));

    const scene = document.createElement("div");
    scene.dataset.layout = "scene";
    const frame = document.createElement("iframe");
    frame.dataset.deviceKind = "phone";
    frame.dataset.slot = "landing-phone-screen";
    scene.append(frame);
    fixture.stage.append(scene);
    setRenderedStageRect(fixture.stage);
    setRenderedPhoneFrameRect(frame, fixture.stage, scene, makeRect(300, 100, 195, 422));

    const accountsCard = document.createElement("article");
    accountsCard.dataset.landingPhoneView = "accounts";
    setRect(accountsCard, () => makeRect(300, 400 - window.scrollY, 300, 200));
    const scanCard = document.createElement("article");
    scanCard.dataset.landingPhoneView = "scan";
    setRect(scanCard, () => makeRect(300, 900 - window.scrollY, 300, 200));
    fixture.journeySection.append(accountsCard, scanCard);

    await renderStory(true);

    const probe = fixture.container.querySelector<HTMLOutputElement>("[data-story-probe]");
    const initialFrame = frame.getBoundingClientRect();
    expect(probe?.dataset.storyStarted).toBe("true");
    expect(probe?.dataset.storyView).toBe("accounts");
    expect(Number.parseFloat(fixture.stage.style.left)).toBeCloseTo(130);
    expect(initialFrame.width).toBeCloseTo(195);
    expect(initialFrame.height).toBeCloseTo(422);

    Object.defineProperty(window, "scrollY", { configurable: true, value: 400 });
    await act(async () => window.dispatchEvent(new Event("scroll")));
    await flushAnimationFrames();
    expect(probe?.dataset.storyStarted).toBe("true");
    expect(probe?.dataset.storyView).toBe("scan");
    expect(frame.getBoundingClientRect().width).toBeGreaterThan(0);

    Object.defineProperty(window, "scrollY", { configurable: true, value: 3000 });
    await act(async () => window.dispatchEvent(new Event("scroll")));
    await flushAnimationFrames();
    expect(probe?.dataset.storyStarted).toBe("false");
    expect(probe?.dataset.storyView).toBe("accounts");
    expect(fixture.stage.style.visibility).toBe("hidden");

    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    await act(async () => window.dispatchEvent(new Event("scroll")));
    await flushAnimationFrames();
    expect(probe?.dataset.storyStarted).toBe("true");
    expect(probe?.dataset.storyView).toBe("accounts");
    expect(fixture.stage.style.visibility).toBe("");
    expect(frame.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(frame.getBoundingClientRect().height).toBeGreaterThan(0);
  });

  it("scales and centers the mobile phone screen inside the journey anchor above its guide card", async () => {
    installFrameQueue();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    fixture = createStoryFixture();
    setRect(fixture.journeyAnchor, () => makeRect(2.8, 1510 - window.scrollY, 384, 455));

    const mobileGuide = document.createElement("article");
    mobileGuide.dataset.landingPhoneGuide = "mobile";
    mobileGuide.dataset.active = "true";
    setRect(mobileGuide, () => makeRect(0, 479, 390, 300));
    const caption = document.createElement("div");
    caption.dataset.landingPhoneCaption = "";
    setRect(caption, () => makeRect(100, 430, 190, 30));
    const scene = document.createElement("div");
    scene.dataset.layout = "scene";
    const frame = document.createElement("iframe");
    frame.dataset.deviceKind = "phone";
    frame.dataset.slot = "landing-phone-screen";
    scene.append(frame);
    fixture.stage.append(scene);
    document.body.append(mobileGuide, caption);
    setRenderedStageRect(fixture.stage);
    setRenderedPhoneFrameRect(frame, fixture.stage, scene, makeRect(65, 111, 260, 500));

    await renderStory();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 1000 });
    await act(async () => window.dispatchEvent(new Event("scroll")));
    await flushAnimationFrames();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 1500 });
    await act(async () => window.dispatchEvent(new Event("scroll")));
    await flushAnimationFrames();

    const screenBounds = frame.getBoundingClientRect();
    const availableTop = fixture.journeyAnchor.getBoundingClientRect().top;
    const availableBottom = Math.min(
      fixture.journeyAnchor.getBoundingClientRect().bottom,
      mobileGuide.getBoundingClientRect().top,
      caption.getBoundingClientRect().top,
    );
    expect(scene.style.transform).toMatch(/^scale\(0\.[0-9]+\)$/);
    expect(fixture.stage.style.transform).toBe("");
    expect(screenBounds.top + screenBounds.height / 2).toBeCloseTo((availableTop + availableBottom) / 2);
    expect(screenBounds.bottom).toBeLessThan(caption.getBoundingClientRect().top);
    expect(screenBounds.height / 0.86).toBeLessThanOrEqual(availableBottom - availableTop + 0.01);
  });

  it("keeps the departing mobile phone fitted when the hidden journey settles at its -100svh offset", async () => {
    installFrameQueue();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    fixture = createStoryFixture();
    Object.defineProperty(fixture.heroSection, "clientHeight", { configurable: true, value: 844 });
    let settledOffset = 0;
    setRect(fixture.journeySection, () => makeRect(0, 844 - window.scrollY - settledOffset, 390, 2000));
    setRect(fixture.journeyAnchor, () => makeRect(3, 844 - window.scrollY - settledOffset, 384, 455));

    const mobileGuide = document.createElement("article");
    mobileGuide.dataset.landingPhoneGuide = "mobile";
    mobileGuide.dataset.active = "true";
    setRect(mobileGuide, () => makeRect(16, 1323 - settledOffset, 358, 300));
    const caption = document.createElement("div");
    caption.dataset.landingPhoneCaption = "";
    setRect(caption, () => makeRect(100, 1274 - settledOffset, 190, 30));
    document.body.append(mobileGuide, caption);

    const scene = document.createElement("div");
    scene.dataset.layout = "scene";
    const frame = document.createElement("iframe");
    frame.dataset.deviceKind = "phone";
    frame.dataset.slot = "landing-phone-screen";
    scene.append(frame);
    fixture.stage.append(scene);
    setRenderedStageRect(fixture.stage);
    setRenderedPhoneFrameRect(frame, fixture.stage, scene, makeRect(65, 111, 260, 500));
    await renderStory(true);

    const probe = fixture.container.querySelector<HTMLOutputElement>("[data-story-probe]");
    await act(async () => {
      fixture?.heroSection.setAttribute("data-scene-step", "leaving");
      await Promise.resolve();
    });
    await flushAnimationFrames();

    const departureScale = getScale(scene);
    const departureTop = Number.parseFloat(fixture.stage.style.top);
    const departurePhoneTop = frame.getBoundingClientRect().top;
    expect(probe?.dataset.storyStarted).toBe("false");
    expect(departureScale).toBeLessThan(1);

    await act(async () => {
      settledOffset = 844;
      fixture?.heroSection.setAttribute("data-scene-step", "settled");
      await Promise.resolve();
    });
    await flushAnimationFrames();

    expect(probe?.dataset.storyStarted).toBe("true");
    expect(getScale(scene)).toBeCloseTo(departureScale);
    expect(Number.parseFloat(fixture.stage.style.top)).toBeCloseTo(departureTop);
    expect(frame.getBoundingClientRect().top).toBeCloseTo(departurePhoneTop);

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 640 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 360 });
    setRect(fixture.journeyAnchor, () => makeRect(10, 80, 620, 96));
    setRenderedPhoneFrameRect(frame, fixture.stage, scene, makeRect(270, 80, 100, 200));
    await act(async () => window.dispatchEvent(new Event("resize")));
    await flushAnimationFrames();
    expect(frame.getBoundingClientRect().height).toBeCloseTo(96 * 0.86);
    expect(frame.getBoundingClientRect().top + frame.getBoundingClientRect().height / 2).toBeCloseTo(128);
  });

  it("fits the mobile phone during departure and smoothly restores its original bounds on return", async () => {
    installFrameQueue();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    fixture = createStoryFixture();
    Object.defineProperty(fixture.heroSection, "clientHeight", { configurable: true, value: 844 });
    let settledOffset = 0;
    setRect(fixture.journeySection, () => makeRect(0, 1000 - window.scrollY - settledOffset, 390, 2000));
    setRect(fixture.journeyAnchor, () => makeRect(3, 1510 - window.scrollY - settledOffset, 384, 455));

    const mobileGuide = document.createElement("article");
    mobileGuide.dataset.landingPhoneGuide = "mobile";
    mobileGuide.dataset.active = "true";
    setRect(mobileGuide, () => makeRect(16, 479 - settledOffset, 358, 300));
    const caption = document.createElement("div");
    caption.dataset.landingPhoneCaption = "";
    setRect(caption, () => makeRect(100, 430 - settledOffset, 190, 30));
    document.body.append(mobileGuide, caption);

    const scene = document.createElement("div");
    scene.dataset.layout = "scene";
    const frame = document.createElement("iframe");
    frame.dataset.deviceKind = "phone";
    frame.dataset.slot = "landing-phone-screen";
    scene.append(frame);
    fixture.stage.append(scene);
    setRenderedStageRect(fixture.stage);
    setRenderedPhoneFrameRect(frame, fixture.stage, scene, makeRect(65, 111, 260, 500));
    await renderStory(true);

    const probe = fixture.container.querySelector<HTMLOutputElement>("[data-story-probe]");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 1500 });
    await act(async () => {
      fixture?.heroSection.setAttribute("data-scene-step", "leaving");
      window.dispatchEvent(new Event("scroll"));
      await Promise.resolve();
    });
    await flushAnimationFrames();

    expect(probe?.dataset.storyStarted).toBe("false");
    expect(scene.style.transform).toMatch(/^scale\(0\.[0-9]+\)$/);
    const departureScale = getScale(scene);
    const departureLeft = Number.parseFloat(fixture.stage.style.left);
    const departureTop = Number.parseFloat(fixture.stage.style.top);
    expect(frame.getBoundingClientRect().bottom).toBeLessThan(caption.getBoundingClientRect().top);

    await act(async () => {
      settledOffset = 844;
      fixture?.heroSection.setAttribute("data-scene-step", "settled");
      await Promise.resolve();
    });
    await flushAnimationFrames();

    expect(probe?.dataset.storyStarted).toBe("true");
    expect(getScale(scene)).toBeCloseTo(departureScale);
    expect(Number.parseFloat(fixture.stage.style.left)).toBeCloseTo(departureLeft);
    expect(Number.parseFloat(fixture.stage.style.top)).toBeCloseTo(departureTop);

    await act(async () => {
      settledOffset = 0;
      fixture?.heroSection.setAttribute("data-scene-step", "returning");
      await Promise.resolve();
    });
    await flushAnimationFrames();

    expect(probe?.dataset.storyStarted).toBe("false");
    expect(scene.style.transform).toBe("");
    expect(fixture.stage.style.left).toBe("0px");
    expect(fixture.stage.style.top).toBe("0px");
    expect(frame.getBoundingClientRect().width).toBeCloseTo(260);
    expect(frame.getBoundingClientRect().height).toBeCloseTo(500);
  });

  it("keeps the desktop phone at its original full-screen scale", async () => {
    installFrameQueue();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
    fixture = createStoryFixture();
    const scene = document.createElement("div");
    scene.dataset.layout = "scene";
    const frame = document.createElement("iframe");
    frame.dataset.deviceKind = "phone";
    frame.dataset.slot = "landing-phone-screen";
    scene.append(frame);
    fixture.stage.append(scene);
    setRenderedStageRect(fixture.stage);
    setRenderedPhoneFrameRect(frame, fixture.stage, scene, makeRect(300, 100, 195, 422));
    await renderStory();

    Object.defineProperty(window, "scrollY", { configurable: true, value: 1500 });
    await act(async () => window.dispatchEvent(new Event("scroll")));
    await flushAnimationFrames();

    expect(scene.style.transform).toBe("");
    expect(fixture.stage.style.left).toBe("400px");
  });

  it("cancels pending frame work and removes listeners when unmounted", async () => {
    installFrameQueue();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
    fixture = createStoryFixture();
    const removeListener = vi.spyOn(window, "removeEventListener");
    await renderStory();

    window.dispatchEvent(new Event("scroll"));
    expect(frames.size).toBe(1);
    await act(async () => root?.unmount());
    root = undefined;

    expect(frames.size).toBe(0);
    expect(removeListener).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith("resize", expect.any(Function));
  });

  it("snaps the mobile phone into its fitted journey bounds when reduced motion is enabled", async () => {
    installFrameQueue();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    fixture = createStoryFixture();
    setRect(fixture.journeyAnchor, () => makeRect(2.8, 1510 - window.scrollY, 384, 455));

    const mobileGuide = document.createElement("article");
    mobileGuide.dataset.landingPhoneGuide = "mobile";
    mobileGuide.dataset.active = "true";
    setRect(mobileGuide, () => makeRect(0, 479, 390, 300));
    const scene = document.createElement("div");
    scene.dataset.layout = "scene";
    const frame = document.createElement("iframe");
    frame.dataset.deviceKind = "phone";
    frame.dataset.slot = "landing-phone-screen";
    scene.append(frame);
    fixture.stage.append(scene);
    fixture.container.append(mobileGuide);
    setRenderedStageRect(fixture.stage);
    setRenderedPhoneFrameRect(frame, fixture.stage, scene, makeRect(65, 111, 260, 500));
    await renderStory();

    Object.defineProperty(window, "scrollY", { configurable: true, value: 978 });
    await act(async () => window.dispatchEvent(new Event("scroll")));
    await flushAnimationFrames();
    expect(scene.style.transform).toBe("");

    Object.defineProperty(window, "scrollY", { configurable: true, value: 979 });
    await act(async () => window.dispatchEvent(new Event("scroll")));
    await flushAnimationFrames();

    expect(scene.style.transform).toMatch(/^scale\(0\.[0-9]+\)$/);
    expect(fixture.stage.style.transform).toBe("");
  });
});
