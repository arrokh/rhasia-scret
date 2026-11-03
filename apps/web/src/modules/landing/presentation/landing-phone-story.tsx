"use client";

import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { landingFlowConfig, type LandingPhoneView } from "./landing-flow.config";
import styles from "./landing-experience.module.css";

const phoneViews = landingFlowConfig.journey.steps.map((step) => step.phoneView);
const initialPhoneView = landingFlowConfig.journey.steps[0]?.phoneView ?? "accounts";

const LandingPhoneStoryContext = createContext<LandingPhoneView>(initialPhoneView);
const LandingPhoneStoryStartedContext = createContext(false);

export function useLandingPhoneStory() {
  return useContext(LandingPhoneStoryContext);
}

export function useLandingPhoneStoryStarted() {
  return useContext(LandingPhoneStoryStartedContext);
}

export function LandingPhoneStoryProvider({ children }: { children: ReactNode }) {
  const [activeView, setActiveView] = useState<LandingPhoneView>(initialPhoneView);
  const [storyStageStarted, setStoryStageStarted] = useState(false);
  const storyStageStartedRef = useRef(false);
  const connectorPathRef = useRef<SVGPathElement>(null);
  const connectorDotRef = useRef<SVGCircleElement>(null);
  const guideNodeRef = useRef<SVGCircleElement>(null);
  const updateLayoutRef = useRef<() => void>(() => undefined);

  useLayoutEffect(() => {
    const heroSection = document.querySelector<HTMLElement>("[data-landing-phone-story-hero]");
    const journeySection = document.querySelector<HTMLElement>("[data-landing-phone-story-journey]");
    const stage = document.querySelector<HTMLElement>("[data-landing-primary-phone]");
    if (!heroSection || !journeySection || !stage) return;

    const initialJourneyAnchor = Array.from(
      document.querySelectorAll<HTMLElement>('[data-landing-phone-anchor="journey"]'),
    ).find((anchor) => anchor.getClientRects().length > 0);
    let journeyAnchorOffset = initialJourneyAnchor
      ? initialJourneyAnchor.getBoundingClientRect().top - journeySection.getBoundingClientRect().top
      : 0;

    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let prefersReducedMotion = reducedMotionQuery.matches;
    let animationFrame = 0;
    let disposed = false;
    let phoneSceneScale = 1;
    let plannedMobileJourneyFit: MobileJourneyPhoneFit | null = null;
    let handoffStartScrollY: number | null = null;

    const getVisibleJourneyAnchor = () =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-landing-phone-anchor="journey"]')).find(
        (anchor) => anchor.getClientRects().length > 0,
      );
    const updateActiveView = () => {
      if (!storyStageStartedRef.current) {
        setActiveView((current) => (current === initialPhoneView ? current : initialPhoneView));
        return;
      }
      const isMobile = window.innerWidth <= 720;
      const viewportCenter = window.innerHeight * (isMobile ? 0.78 : 0.5);
      const activeCard = Array.from(journeySection.querySelectorAll<HTMLElement>("[data-landing-phone-view]"))
        .filter((card) => card.getClientRects().length > 0)
        .map((card) => {
          const bounds = card.getBoundingClientRect();
          const nearestPoint = Math.max(bounds.top, Math.min(viewportCenter, bounds.bottom));
          return { card, distance: Math.abs(nearestPoint - viewportCenter) };
        })
        .sort((first, second) => first.distance - second.distance)[0]?.card;
      const nextView = activeCard?.dataset.landingPhoneView;
      if (nextView && phoneViews.includes(nextView as LandingPhoneView)) {
        setActiveView((current) => (current === nextView ? current : (nextView as LandingPhoneView)));
      }
    };

    const updateLayout = () => {
      if (disposed) return;
      const sceneStep = heroSection.dataset.sceneStep;
      const canStartStory = sceneStep === "settled" && heroSection.getAttribute("aria-busy") !== "true";
      journeySection.dataset.sceneSettled = `${canStartStory}`;
      const journeyAnchor = getVisibleJourneyAnchor();
      if (!journeyAnchor) return;

      const scrollY = window.scrollY;
      const journeyRect = journeyAnchor.getBoundingClientRect();
      const journeyStoryRect = journeySection.getBoundingClientRect();
      const isMobile = window.innerWidth <= 720;
      const shouldHandoff = canStartStory && journeyStoryRect.top < window.innerHeight && journeyStoryRect.bottom > 0;
      if (storyStageStartedRef.current !== shouldHandoff) {
        storyStageStartedRef.current = shouldHandoff;
        handoffStartScrollY = shouldHandoff ? scrollY : null;
        setStoryStageStarted(shouldHandoff);
      }
      if (!shouldHandoff) {
        const isMobileDeparture = isMobile && sceneStep === "leaving";
        const shouldDockToJourney = sceneStep === "leaving" || sceneStep === "settled";
        const centerX = shouldDockToJourney ? journeyRect.left + journeyRect.width / 2 : window.innerWidth / 2;
        let left = centerX - window.innerWidth / 2;
        let top = 0;
        const mobileFit = isMobileDeparture
          ? plannedMobileJourneyFit
            ? (retargetMobileJourneyPhoneFit(plannedMobileJourneyFit, journeyAnchor, heroSection.clientHeight) ??
              plannedMobileJourneyFit)
            : getMobileJourneyPhoneFit(stage, journeyAnchor, phoneSceneScale, heroSection.clientHeight)
          : null;
        if (mobileFit) {
          plannedMobileJourneyFit = mobileFit;
          setPhoneSceneScale(stage, mobileFit.scale);
          phoneSceneScale = mobileFit.scale;
          left = mobileFit.centerX - mobileFit.screenOffsetX * mobileFit.scale - window.innerWidth / 2;
          top = mobileFit.centerY - mobileFit.screenOffsetY * mobileFit.scale - window.innerHeight / 2;
        } else {
          plannedMobileJourneyFit = null;
          setPhoneSceneScale(stage, 1);
          phoneSceneScale = 1;
        }
        stage.style.visibility = sceneStep === "settled" && journeyStoryRect.bottom <= 0 ? "hidden" : "";
        journeySection.dataset.phoneVisible = stage.style.visibility !== "hidden" ? "true" : "false";
        stage.style.left = `${left}px`;
        stage.style.top = `${top}px`;
        stage.style.width = `${window.innerWidth}px`;
        stage.style.height = `${window.innerHeight}px`;
        clearConnector(connectorPathRef.current, connectorDotRef.current, guideNodeRef.current);
        return;
      }

      if (journeyRect.top < window.innerHeight && journeyStoryRect.top > 0) {
        journeyAnchorOffset = journeyRect.top - journeyStoryRect.top;
      }

      const journeyDocTop = journeyStoryRect.top + scrollY + journeyAnchorOffset;
      const journeyDockY = window.innerHeight * (isMobile ? 0.015 : 0.11);
      const targetJourneyY = journeyDocTop - journeyDockY;
      const defaultHandoffStartY = heroSection.getBoundingClientRect().top + scrollY + heroSection.clientHeight * 0.46;
      const handoffStartY = isMobile
        ? Math.min(defaultHandoffStartY, targetJourneyY - 1)
        : (handoffStartScrollY ?? scrollY);
      const journeyEndY = Math.max(handoffStartY + 1, targetJourneyY);
      const progress =
        isMobile && journeyStoryRect.top <= 0
          ? 1
          : Math.min(1, Math.max(0, (scrollY - handoffStartY) / (journeyEndY - handoffStartY)));
      const easedProgress = prefersReducedMotion ? (progress >= 0.5 ? 1 : 0) : 1 - (1 - progress) ** 3;

      const departureFit =
        isMobile && plannedMobileJourneyFit
          ? (retargetMobileJourneyPhoneFit(plannedMobileJourneyFit, journeyAnchor) ?? plannedMobileJourneyFit)
          : null;
      const phoneFit =
        departureFit ?? (isMobile ? getMobileJourneyPhoneFit(stage, journeyAnchor, phoneSceneScale) : null);
      const handoffProgress = departureFit ? 1 : easedProgress;
      const nextPhoneSceneScale = phoneFit ? 1 + (phoneFit.scale - 1) * handoffProgress : 1;
      setPhoneSceneScale(stage, nextPhoneSceneScale);
      phoneSceneScale = nextPhoneSceneScale;

      const settledCenterX = journeyRect.left + journeyRect.width / 2;
      let left = settledCenterX - window.innerWidth / 2;
      let top = 0;
      if (handoffProgress > 0) {
        const journeyCenterX = phoneFit ? phoneFit.centerX - phoneFit.screenOffsetX * phoneFit.scale : settledCenterX;
        const journeyCenterY = phoneFit
          ? phoneFit.centerY - phoneFit.screenOffsetY * phoneFit.scale
          : window.innerHeight / 2;
        left += (journeyCenterX - window.innerWidth / 2 - left) * handoffProgress;
        top = (journeyCenterY - window.innerHeight / 2) * handoffProgress;
      }

      stage.style.visibility = "";
      stage.style.left = `${left}px`;
      stage.style.top = `${top}px`;
      stage.style.width = `${window.innerWidth}px`;
      stage.style.height = `${window.innerHeight}px`;
      const phoneFitsJourneyEnd = keepPhoneWithinJourneyEnd(stage, journeySection);
      const journeyEnd = journeySection.querySelector<HTMLElement>("[data-landing-phone-story-end]");
      const journeyGuideActive = !journeyEnd || journeyEnd.getBoundingClientRect().top > 0;
      journeySection.dataset.phoneVisible = phoneFitsJourneyEnd ? "true" : "false";
      if (!phoneFitsJourneyEnd) {
        stage.style.visibility = "hidden";
        clearConnector(connectorPathRef.current, connectorDotRef.current, guideNodeRef.current);
        return;
      }
      updateConnector(
        stage,
        connectorPathRef.current,
        connectorDotRef.current,
        guideNodeRef.current,
        isMobile,
        journeyGuideActive,
      );
    };

    const scheduleUpdate = () => {
      if (animationFrame !== 0) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        updateLayout();
        updateActiveView();
      });
    };
    const handleReducedMotionChange = () => {
      prefersReducedMotion = reducedMotionQuery.matches;
      scheduleUpdate();
    };
    const handlePhoneSceneTransitionEnd = (event: TransitionEvent) => {
      const phoneScene = stage.querySelector<HTMLElement>('[data-layout="scene"]');
      if (event.target !== phoneScene || event.propertyName !== "transform") return;
      plannedMobileJourneyFit = null;
      scheduleUpdate();
    };

    let screenFrame: HTMLIFrameElement | null = null;
    let observedScreenDocument: Document | null = null;
    let screenFrameLoadListener: (() => void) | null = null;
    const screenTargetObserver = new MutationObserver(scheduleUpdate);
    const observeScreenDocument = () => {
      const nextScreenFrame = stage.querySelector<HTMLIFrameElement>(
        'iframe[data-slot="landing-phone-screen"][data-device-kind="phone"]',
      );
      if (nextScreenFrame !== screenFrame) {
        if (screenFrame && screenFrameLoadListener) {
          screenFrame.removeEventListener("load", screenFrameLoadListener);
        }
        screenTargetObserver.disconnect();
        screenFrame = nextScreenFrame;
        observedScreenDocument = null;
        screenFrameLoadListener = screenFrame
          ? () => {
              observeScreenDocument();
              scheduleUpdate();
            }
          : null;
        if (screenFrame && screenFrameLoadListener) {
          screenFrame.addEventListener("load", screenFrameLoadListener);
        }
      }

      let screenDocument: Document | null = null;
      try {
        screenDocument = screenFrame?.contentDocument ?? null;
      } catch {
        screenDocument = null;
      }
      if (!screenDocument || screenDocument === observedScreenDocument) return;
      observedScreenDocument = screenDocument;
      screenTargetObserver.disconnect();
      screenTargetObserver.observe(screenDocument, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["data-landing-phone-target"],
      });
    };
    const targetObserver = new MutationObserver(() => {
      observeScreenDocument();
      scheduleUpdate();
    });

    updateLayoutRef.current = updateLayout;
    scheduleUpdate();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    stage.addEventListener("transitionend", handlePhoneSceneTransitionEnd);
    reducedMotionQuery.addEventListener("change", handleReducedMotionChange);

    const resizeObserver = new ResizeObserver(scheduleUpdate);
    targetObserver.observe(heroSection, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-scene-step", "data-visible", "aria-busy"],
    });
    targetObserver.observe(stage, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-landing-phone-target"],
    });
    observeScreenDocument();
    resizeObserver.observe(heroSection);
    resizeObserver.observe(journeySection);
    resizeObserver.observe(stage);

    return () => {
      disposed = true;
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      stage.removeEventListener("transitionend", handlePhoneSceneTransitionEnd);
      reducedMotionQuery.removeEventListener("change", handleReducedMotionChange);
      if (screenFrame && screenFrameLoadListener) {
        screenFrame.removeEventListener("load", screenFrameLoadListener);
      }
      resizeObserver.disconnect();
      targetObserver.disconnect();
      screenTargetObserver.disconnect();
      setPhoneSceneScale(stage, 1);
      if (animationFrame !== 0) window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => updateLayoutRef.current());
    return () => window.cancelAnimationFrame(frame);
  }, [activeView, storyStageStarted]);

  return (
    <LandingPhoneStoryStartedContext.Provider value={storyStageStarted}>
      <LandingPhoneStoryContext.Provider value={activeView}>
        {children}
        <svg className={styles.phoneStoryConnector} aria-hidden="true">
          <g key={`${storyStageStarted ? "story" : "intro"}-${activeView}`} className={styles.phoneConnectorTransition}>
            <path ref={connectorPathRef} />
            <circle ref={connectorDotRef} r="3.5" visibility="hidden" />
            <circle ref={guideNodeRef} data-landing-guide-node r="3" visibility="hidden" />
          </g>
        </svg>
      </LandingPhoneStoryContext.Provider>
    </LandingPhoneStoryStartedContext.Provider>
  );
}

type PhoneRect = Readonly<{ left: number; right: number; top: number; bottom: number }>;
type PhoneTarget = Readonly<{ x: number; y: number; phoneBounds: PhoneRect }>;
type MobileJourneyPhoneFit = Readonly<{
  scale: number;
  centerX: number;
  centerY: number;
  screenOffsetX: number;
  screenOffsetY: number;
  screenWidth: number;
  screenHeight: number;
}>;
type MobileJourneyFitArea = Readonly<{
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}>;

const PHONE_SCREEN_FIT_RATIO = 0.86;
const PHONE_TARGET_HIGHLIGHT_OUTSET = 5;
const PHONE_GUIDE_INSET = 20;
const PHONE_BOUNDARY_CLEARANCE = 18;

function setPhoneSceneScale(stage: HTMLElement, scale: number) {
  const phoneScene = stage.querySelector<HTMLElement>('[data-layout="scene"]');
  if (!phoneScene) return;
  if (scale >= 0.9999) {
    phoneScene.style.removeProperty("transform");
    phoneScene.style.removeProperty("transform-origin");
    return;
  }
  phoneScene.style.transformOrigin = "center center";
  phoneScene.style.transform = `scale(${scale})`;
}

function getPhoneScreenFrame(stage: HTMLElement) {
  return stage.querySelector<HTMLIFrameElement>('iframe[data-slot="landing-phone-screen"][data-device-kind="phone"]');
}

function getPhoneVisualBounds(stage: HTMLElement): PhoneRect | null {
  const visual = getPhoneScreenFrame(stage) ?? stage.querySelector<HTMLElement>('[class*="__phoneFallbackFrame"]');
  if (!visual) return null;
  return toPhoneRect(visual.getBoundingClientRect());
}

function toPhoneRect(bounds: DOMRect): PhoneRect {
  return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
}

function intersectPhoneRects(bounds: PhoneRect, clip: PhoneRect): PhoneRect | null {
  const left = Math.max(bounds.left, clip.left);
  const right = Math.min(bounds.right, clip.right);
  const top = Math.max(bounds.top, clip.top);
  const bottom = Math.min(bounds.bottom, clip.bottom);
  if (right <= left || bottom <= top) return null;
  return { left, right, top, bottom };
}

function getMobileJourneyFitArea(
  journeyAnchor: HTMLElement,
  anticipatedSettledOffset = 0,
): MobileJourneyFitArea | null {
  const anchorBounds = journeyAnchor.getBoundingClientRect();
  const mobileGuide = document.querySelector<HTMLElement>('[data-landing-phone-guide="mobile"][data-active="true"]');
  const guideTop = mobileGuide?.getBoundingClientRect().top ?? anchorBounds.bottom;
  const captionTop =
    getVisibleElement("[data-landing-phone-caption]")?.getBoundingClientRect().top ?? anchorBounds.bottom;
  const availableBottom = Math.min(anchorBounds.bottom, guideTop, captionTop);
  const availableHeight = availableBottom - anchorBounds.top;
  if (anchorBounds.width <= 0 || availableHeight <= 0) return null;

  return {
    centerX: anchorBounds.left + anchorBounds.width / 2,
    centerY: anchorBounds.top + availableHeight / 2 - anticipatedSettledOffset,
    width: anchorBounds.width,
    height: availableHeight,
  };
}

function getMobileJourneyPhoneFit(
  stage: HTMLElement,
  journeyAnchor: HTMLElement,
  currentPhoneSceneScale: number,
  anticipatedSettledOffset = 0,
): MobileJourneyPhoneFit | null {
  const screenFrame = getPhoneScreenFrame(stage);
  if (!screenFrame) return null;
  const fitArea = getMobileJourneyFitArea(journeyAnchor, anticipatedSettledOffset);
  if (!fitArea) return null;

  const screenBounds = screenFrame.getBoundingClientRect();
  const stageBounds = stage.getBoundingClientRect();
  const stageWidth = Number.parseFloat(stage.style.width) || window.innerWidth;
  const stageHeight = Number.parseFloat(stage.style.height) || window.innerHeight;
  const stageScaleX = stageBounds.width > 0 ? stageBounds.width / stageWidth : 1;
  const stageScaleY = stageBounds.height > 0 ? stageBounds.height / stageHeight : 1;
  const screenScaleX = stageScaleX * currentPhoneSceneScale;
  const screenScaleY = stageScaleY * currentPhoneSceneScale;
  if (screenBounds.width <= 0 || screenBounds.height <= 0 || screenScaleX <= 0 || screenScaleY <= 0) {
    return null;
  }

  const stageCenterX = stageBounds.left + stageBounds.width / 2;
  const stageCenterY = stageBounds.top + stageBounds.height / 2;
  const screenOffsetX = (screenBounds.left + screenBounds.width / 2 - stageCenterX) / screenScaleX;
  const screenOffsetY = (screenBounds.top + screenBounds.height / 2 - stageCenterY) / screenScaleY;
  const screenWidth = screenBounds.width / screenScaleX;
  const screenHeight = screenBounds.height / screenScaleY;
  const scale = Math.min(
    1,
    (fitArea.width * PHONE_SCREEN_FIT_RATIO) / screenWidth,
    (fitArea.height * PHONE_SCREEN_FIT_RATIO) / screenHeight,
  );

  return { ...fitArea, scale, screenOffsetX, screenOffsetY, screenWidth, screenHeight };
}

function retargetMobileJourneyPhoneFit(
  fit: MobileJourneyPhoneFit,
  journeyAnchor: HTMLElement,
  anticipatedSettledOffset = 0,
): MobileJourneyPhoneFit | null {
  const fitArea = getMobileJourneyFitArea(journeyAnchor, anticipatedSettledOffset);
  if (!fitArea) return null;

  return {
    ...fit,
    ...fitArea,
    scale: Math.min(
      1,
      (fitArea.width * PHONE_SCREEN_FIT_RATIO) / fit.screenWidth,
      (fitArea.height * PHONE_SCREEN_FIT_RATIO) / fit.screenHeight,
    ),
  };
}

function isPhoneTargetEligible(target: HTMLElement) {
  if (target.closest('[aria-hidden="true"], [data-active="false"]')) return false;
  const bounds = target.getBoundingClientRect();
  return bounds.width > 0 && bounds.height > 0;
}

function findPhoneTarget(root: ParentNode) {
  const markedTarget = Array.from(root.querySelectorAll<HTMLElement>("[data-landing-phone-target]")).find(
    isPhoneTargetEligible,
  );
  if (markedTarget) return markedTarget;
  return Array.from(root.querySelectorAll<HTMLElement>('a[href="/vaults/accounts/new"]')).find(isPhoneTargetEligible);
}

function toPhoneTarget(bounds: PhoneRect, phoneBounds: PhoneRect, highlightOutset: number): PhoneTarget {
  return {
    x: bounds.right + highlightOutset,
    y: (bounds.top + bounds.bottom) / 2,
    phoneBounds,
  };
}

function getPhoneTarget(stage: HTMLElement): PhoneTarget | null {
  const phoneBounds = getPhoneVisualBounds(stage);
  const inlineTarget = findPhoneTarget(stage);
  if (inlineTarget) {
    const targetBounds = toPhoneRect(inlineTarget.getBoundingClientRect());
    const clippedBounds = phoneBounds ? intersectPhoneRects(targetBounds, phoneBounds) : targetBounds;
    if (!clippedBounds) return null;
    const renderedWidth = targetBounds.right - targetBounds.left;
    const targetScale = inlineTarget.offsetWidth > 0 ? renderedWidth / inlineTarget.offsetWidth : 1;
    const highlightOutset = PHONE_TARGET_HIGHLIGHT_OUTSET * targetScale;
    return toPhoneTarget(clippedBounds, phoneBounds ?? clippedBounds, highlightOutset);
  }

  const screenFrame = getPhoneScreenFrame(stage);
  if (!screenFrame) return null;

  try {
    const frameWindow = screenFrame.contentWindow;
    const target = screenFrame.contentDocument ? findPhoneTarget(screenFrame.contentDocument) : null;
    if (!frameWindow || !target) return null;

    const viewportWidth = frameWindow.innerWidth;
    const viewportHeight = frameWindow.innerHeight;
    const frameBounds = screenFrame.getBoundingClientRect();
    const targetBounds = target.getBoundingClientRect();
    if (
      viewportWidth < 1 ||
      viewportHeight < 1 ||
      frameBounds.width < 1 ||
      frameBounds.height < 1 ||
      targetBounds.width < 1 ||
      targetBounds.height < 1
    ) {
      return null;
    }

    const viewportBounds = { left: 0, top: 0, right: viewportWidth, bottom: viewportHeight };
    const clippedTarget = intersectPhoneRects(toPhoneRect(targetBounds), viewportBounds);
    if (!clippedTarget) return null;
    const mappedBounds = {
      left: frameBounds.left + (clippedTarget.left / viewportWidth) * frameBounds.width,
      right: frameBounds.left + (clippedTarget.right / viewportWidth) * frameBounds.width,
      top: frameBounds.top + (clippedTarget.top / viewportHeight) * frameBounds.height,
      bottom: frameBounds.top + (clippedTarget.bottom / viewportHeight) * frameBounds.height,
    };
    return toPhoneTarget(
      mappedBounds,
      toPhoneRect(frameBounds),
      (PHONE_TARGET_HIGHLIGHT_OUTSET * frameBounds.width) / viewportWidth,
    );
  } catch {
    return null;
  }
}

function clearConnector(path: SVGPathElement | null, dot: SVGCircleElement | null, guideNode: SVGCircleElement | null) {
  path?.setAttribute("d", "");
  dot?.setAttribute("visibility", "hidden");
  guideNode?.setAttribute("visibility", "hidden");
}

function keepPhoneWithinJourneyEnd(stage: HTMLElement, journeySection: HTMLElement) {
  const phoneBounds = getPhoneVisualBounds(stage);
  if (!phoneBounds) return true;

  const note = journeySection.querySelector<HTMLElement>("[data-landing-phone-story-end]");
  const finalCta = document.querySelector<HTMLElement>('[data-slot="landing-final-cta"]');
  const boundaryTop = Math.min(
    note?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
    finalCta?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
    window.innerHeight,
  );
  const chassisClearance = Math.max(PHONE_BOUNDARY_CLEARANCE, (phoneBounds.bottom - phoneBounds.top) * 0.06);
  const maxBottom = boundaryTop - chassisClearance;
  const minimumVisibleBottom = 8;
  if (maxBottom <= minimumVisibleBottom) return false;
  if (phoneBounds.bottom <= maxBottom) return phoneBounds.bottom > minimumVisibleBottom;

  const currentTop = Number.parseFloat(stage.style.top) || 0;
  stage.style.top = `${currentTop + maxBottom - phoneBounds.bottom}px`;
  const adjustedPhoneBounds = getPhoneVisualBounds(stage);
  return Boolean(
    adjustedPhoneBounds &&
    adjustedPhoneBounds.bottom > minimumVisibleBottom &&
    adjustedPhoneBounds.bottom <= maxBottom + 1,
  );
}

function getVisibleElement(selector: string) {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
    (element) => element.getClientRects().length > 0,
  );
}

function updateConnector(
  stage: HTMLElement,
  path: SVGPathElement | null,
  dot: SVGCircleElement | null,
  guideNode: SVGCircleElement | null,
  isMobile: boolean,
  journeyGuideActive: boolean,
) {
  if (!path || !dot || !guideNode) return;
  const guideSelector = isMobile
    ? '[data-landing-phone-guide="mobile"][data-active="true"]'
    : '[data-landing-phone-guide="right"][data-active="true"]';
  const card = getVisibleElement(guideSelector);
  const target = getPhoneTarget(stage);
  if (
    !journeyGuideActive ||
    !card ||
    !target ||
    stage.dataset.visible !== "true" ||
    stage.style.visibility === "hidden" ||
    target.x < 0 ||
    target.x > window.innerWidth ||
    target.y < 0 ||
    target.y > window.innerHeight
  ) {
    clearConnector(path, dot, guideNode);
    return;
  }

  const cardRect = card.getBoundingClientRect();
  if (cardRect.bottom <= 0 || cardRect.top >= window.innerHeight) {
    clearConnector(path, dot, guideNode);
    return;
  }

  const guideX = cardRect.left + PHONE_GUIDE_INSET;
  const guideY = cardRect.top + 1;
  let connectorPath: string;
  if (isMobile) {
    const caption = getVisibleElement("[data-landing-phone-caption]");
    const captionBounds = caption ? toPhoneRect(caption.getBoundingClientRect()) : null;
    const phoneBounds = target.phoneBounds;
    const rightExitX = Math.min(
      window.innerWidth - 4,
      Math.max(phoneBounds.right, captionBounds?.right ?? phoneBounds.right) + 14,
    );
    const routeBottom = cardRect.top - 4;
    const obstaclesBottom = Math.max(phoneBounds.bottom, captionBounds?.bottom ?? phoneBounds.bottom);
    if (rightExitX <= target.x || routeBottom < obstaclesBottom + 2 || guideY >= window.innerHeight) {
      clearConnector(path, dot, guideNode);
      return;
    }
    connectorPath =
      `M ${target.x} ${target.y} ` +
      `C ${rightExitX} ${target.y}, ${rightExitX} ${target.y}, ${rightExitX} ${target.y + 12} ` +
      `L ${rightExitX} ${routeBottom - 8} ` +
      `Q ${rightExitX} ${routeBottom}, ${rightExitX - 8} ${routeBottom} ` +
      `L ${guideX + 8} ${routeBottom} ` +
      `Q ${guideX} ${routeBottom}, ${guideX} ${guideY}`;
  } else {
    connectorPath =
      `M ${guideX} ${guideY} ` + `C ${guideX - 82} ${guideY}, ${target.x + 86} ${target.y}, ${target.x} ${target.y}`;
  }

  path.setAttribute("d", connectorPath);
  dot.setAttribute("cx", `${target.x}`);
  dot.setAttribute("cy", `${target.y}`);
  dot.setAttribute("visibility", "visible");
  guideNode.setAttribute("cx", `${guideX}`);
  guideNode.setAttribute("cy", `${guideY}`);
  guideNode.setAttribute("visibility", "visible");
}
