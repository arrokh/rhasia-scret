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
    let selectedView = initialPhoneView;
    let plannedMobileJourneyFit: MobileJourneyPhoneFit | null = null;
    const connectorMotion: ConnectorMotionState = {
      activeCard: null,
      isMobile: null,
      phonePoint: null,
      guidePointDocument: null,
      phoneBounds: null,
      travel: null,
    };
    let handoffStartScrollY: number | null = null;

    const getVisibleJourneyAnchor = () =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-landing-phone-anchor="journey"]')).find(
        (anchor) => anchor.getClientRects().length > 0,
      );
    const updateActiveView = () => {
      if (!storyStageStartedRef.current) {
        if (selectedView !== initialPhoneView) {
          selectedView = initialPhoneView;
          setActiveView(initialPhoneView);
        }
        return;
      }
      const isMobile = window.innerWidth <= 720;
      const cards = Array.from(journeySection.querySelectorAll<HTMLElement>("[data-landing-phone-view]"))
        .filter((card) => card.getClientRects().length > 0)
        .map((card) => ({ card, bounds: card.getBoundingClientRect() }));
      const phoneTop = stage
        .querySelector<HTMLElement>("[data-landing-phone-body-bounds]")
        ?.getBoundingClientRect().top;
      const firstCardHeight = cards[0]?.bounds.height ?? 0;
      const desktopAnchor = phoneTop === undefined ? window.innerHeight / 2 : phoneTop + firstCardHeight / 2;
      const activeCardAnchor = isMobile
        ? window.innerHeight * 0.78
        : Math.max(0, Math.min(window.innerHeight, desktopAnchor));
      const candidates = cards
        .map(({ card, bounds }) => {
          const nearestPoint = Math.max(bounds.top, Math.min(activeCardAnchor, bounds.bottom));
          return { card, distance: Math.abs(nearestPoint - activeCardAnchor) };
        })
        .sort((first, second) => first.distance - second.distance);
      const closestCard = candidates[0];
      const currentCard = candidates.find(({ card }) => card.dataset.landingPhoneView === selectedView);
      const activeCard =
        currentCard && closestCard && currentCard.distance <= closestCard.distance + ACTIVE_VIEW_SWITCH_HYSTERESIS_PX
          ? currentCard.card
          : closestCard?.card;
      const nextView = activeCard?.dataset.landingPhoneView;
      if (nextView && phoneViews.includes(nextView as LandingPhoneView) && nextView !== selectedView) {
        selectedView = nextView as LandingPhoneView;
        setActiveView(selectedView);
      }
    };

    const updateLayout = () => {
      if (disposed) return;
      const sceneStep = heroSection.dataset.sceneStep;
      const canStartStory = sceneStep === "settled" && heroSection.getAttribute("aria-busy") !== "true";
      journeySection.dataset.sceneSettled = `${canStartStory}`;
      const mobileStage = journeySection.querySelector<HTMLElement>("[data-landing-mobile-stage]");
      if (window.innerWidth <= 720 && mobileStage) {
        const height = mobileStage.getBoundingClientRect().height;
        const headerHeight = document.querySelector("[data-landing-header]")?.getBoundingClientRect().height ?? 0;
        const top = Math.max(headerHeight, (window.innerHeight + headerHeight - height) / 2);
        journeySection.style.setProperty("--landing-mobile-stage-height", `${height}px`);
        journeySection.style.setProperty("--landing-mobile-stage-top", `${top}px`);
      }
      const journeyAnchor = getVisibleJourneyAnchor();
      if (!journeyAnchor) {
        clearConnector(connectorPathRef.current, connectorDotRef.current, guideNodeRef.current, connectorMotion);
        return;
      }

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
        clearConnector(connectorPathRef.current, connectorDotRef.current, guideNodeRef.current, connectorMotion);
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
        clearConnector(connectorPathRef.current, connectorDotRef.current, guideNodeRef.current, connectorMotion);
        return;
      }
      const connectorIsTraveling = updateConnector(
        stage,
        connectorPathRef.current,
        connectorDotRef.current,
        guideNodeRef.current,
        isMobile,
        journeyGuideActive,
        connectorMotion,
        prefersReducedMotion,
      );
      if (connectorIsTraveling) scheduleUpdate();
    };

    function scheduleUpdate() {
      if (animationFrame !== 0) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        updateLayout();
        updateActiveView();
      });
    }
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

    const handleResize = () => {
      plannedMobileJourneyFit = null;
      scheduleUpdate();
    };
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.some(({ target }) => target.hasAttribute("data-landing-phone-body-bounds"))) {
        plannedMobileJourneyFit = null;
      }
      scheduleUpdate();
    });
    let screenFrame: HTMLIFrameElement | null = null;
    let observedScreenDocument: Document | null = null;
    let screenFrameLoadListener: (() => void) | null = null;
    const screenTargetObserver = new MutationObserver(scheduleUpdate);
    const observeScreenDocument = () => {
      const bodyBounds = stage.querySelector<HTMLElement>("[data-landing-phone-body-bounds]");
      if (bodyBounds) resizeObserver.observe(bodyBounds);
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
    window.addEventListener("resize", handleResize);
    stage.addEventListener("transitionend", handlePhoneSceneTransitionEnd);
    reducedMotionQuery.addEventListener("change", handleReducedMotionChange);

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
    const mobileStage = journeySection.querySelector<HTMLElement>("[data-landing-mobile-stage]");
    if (mobileStage) resizeObserver.observe(mobileStage);
    resizeObserver.observe(stage);

    return () => {
      disposed = true;
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", handleResize);
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
          <g>
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
type ConnectorPoint = Readonly<{ x: number; y: number }>;
type PhoneTarget = Readonly<{ x: number; y: number; phoneBounds: PhoneRect }>;
type ConnectorTravel = {
  fromPhone: ConnectorPoint;
  fromGuideDocument: ConnectorPoint;
  lastPhoneBounds: PhoneRect;
  startedAt: number;
  duration: number;
};
type ConnectorMotionState = {
  activeCard: HTMLElement | null;
  isMobile: boolean | null;
  phonePoint: ConnectorPoint | null;
  guidePointDocument: ConnectorPoint | null;
  phoneBounds: PhoneRect | null;
  travel: ConnectorTravel | null;
};
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
const PHONE_GUIDE_BORDER_CLEARANCE = 4;
const PHONE_MOBILE_GUIDE_ROUTE_OFFSET = 5;
const PHONE_BOUNDARY_CLEARANCE = 24;
const ACTIVE_VIEW_SWITCH_HYSTERESIS_PX = 64;
const CONNECTOR_TRAVEL_BASE_DURATION_MS = 180;
const CONNECTOR_TRAVEL_DISTANCE_DURATION_MS_PER_PX = 0.28;
const CONNECTOR_TRAVEL_MAX_DURATION_MS = 340;

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
  const visual = getPhoneScreenFrame(stage) ?? stage.querySelector<HTMLElement>("[data-landing-phone-fallback-frame]");
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
  const screenBounds = getPhoneVisualBounds(stage);
  if (!screenBounds) return null;
  const fitArea = getMobileJourneyFitArea(journeyAnchor, anticipatedSettledOffset);
  if (!fitArea) return null;

  const visualWidth = screenBounds.right - screenBounds.left;
  const visualHeight = screenBounds.bottom - screenBounds.top;
  const stageBounds = stage.getBoundingClientRect();
  const stageWidth = Number.parseFloat(stage.style.width) || window.innerWidth;
  const stageHeight = Number.parseFloat(stage.style.height) || window.innerHeight;
  const stageScaleX = stageBounds.width > 0 ? stageBounds.width / stageWidth : 1;
  const stageScaleY = stageBounds.height > 0 ? stageBounds.height / stageHeight : 1;
  const screenScaleX = stageScaleX * currentPhoneSceneScale;
  const screenScaleY = stageScaleY * currentPhoneSceneScale;
  if (visualWidth <= 0 || visualHeight <= 0 || screenScaleX <= 0 || screenScaleY <= 0) {
    return null;
  }

  const stageCenterX = stageBounds.left + stageBounds.width / 2;
  const stageCenterY = stageBounds.top + stageBounds.height / 2;
  const screenOffsetX = (screenBounds.left + visualWidth / 2 - stageCenterX) / screenScaleX;
  const screenOffsetY = (screenBounds.top + visualHeight / 2 - stageCenterY) / screenScaleY;
  const screenWidth = visualWidth / screenScaleX;
  const screenHeight = visualHeight / screenScaleY;
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

function clearConnector(
  path: SVGPathElement | null,
  dot: SVGCircleElement | null,
  guideNode: SVGCircleElement | null,
  motion: ConnectorMotionState,
) {
  path?.setAttribute("d", "");
  dot?.setAttribute("visibility", "hidden");
  guideNode?.setAttribute("visibility", "hidden");
  guideNode?.setAttribute("r", "3");
  resetConnectorMotion(motion);
}

function resetConnectorMotion(motion: ConnectorMotionState) {
  motion.activeCard = null;
  motion.isMobile = null;
  motion.phonePoint = null;
  motion.guidePointDocument = null;
  motion.phoneBounds = null;
  motion.travel = null;
}

function keepPhoneWithinJourneyEnd(stage: HTMLElement, journeySection: HTMLElement) {
  const getBodyBounds = () =>
    stage.querySelector<HTMLElement>("[data-landing-phone-body-bounds]")?.getBoundingClientRect();
  const phoneBounds = getBodyBounds();
  if (!phoneBounds) return true;

  const note = journeySection.querySelector<HTMLElement>("[data-landing-phone-story-end]");
  const finalCta = document.querySelector<HTMLElement>('[data-slot="landing-final-cta"]');
  const boundaryTop = Math.min(
    note?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
    finalCta?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
    window.innerHeight,
  );
  const captionTop = getVisibleElement("[data-landing-phone-caption]")?.getBoundingClientRect().top;
  const maxBottom = Math.min(
    boundaryTop - PHONE_BOUNDARY_CLEARANCE,
    captionTop === undefined ? Number.POSITIVE_INFINITY : captionTop - 8,
  );
  const minimumVisibleBottom = 8;
  if (maxBottom <= minimumVisibleBottom) return false;
  if (phoneBounds.bottom <= maxBottom) return phoneBounds.bottom > minimumVisibleBottom;

  const currentTop = Number.parseFloat(stage.style.top) || 0;
  stage.style.top = `${currentTop + maxBottom - phoneBounds.bottom}px`;
  const adjustedPhoneBounds = getBodyBounds();
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
  motion: ConnectorMotionState,
  prefersReducedMotion: boolean,
): boolean {
  if (!path || !dot || !guideNode) return false;
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
    clearConnector(path, dot, guideNode, motion);
    return false;
  }

  const cardRect = card.getBoundingClientRect();
  if (cardRect.bottom <= 0 || cardRect.top >= window.innerHeight) {
    clearConnector(path, dot, guideNode, motion);
    return false;
  }

  const destinationGuideX = isMobile
    ? cardRect.right - PHONE_GUIDE_INSET
    : cardRect.left + PHONE_GUIDE_BORDER_CLEARANCE;
  let destinationGuideY = cardRect.top + 1;
  if (!isMobile) {
    const cardStyle = getComputedStyle(card);
    const topCornerRadius = Number.parseFloat(cardStyle.borderTopLeftRadius) || 0;
    const bottomCornerRadius = Number.parseFloat(cardStyle.borderBottomLeftRadius) || 0;
    const minimumGuideY = cardRect.top + topCornerRadius + PHONE_GUIDE_BORDER_CLEARANCE;
    const maximumGuideY = cardRect.bottom - bottomCornerRadius - PHONE_GUIDE_BORDER_CLEARANCE;
    destinationGuideY = Math.max(minimumGuideY, Math.min(target.y, maximumGuideY));
  }

  const destinationPhonePoint = { x: target.x, y: target.y };
  const destinationGuideDocumentPoint = {
    x: destinationGuideX + window.scrollX,
    y: destinationGuideY + window.scrollY,
  };
  if (motion.activeCard !== card || motion.isMobile !== isMobile) {
    const fromPhone = motion.phonePoint;
    const fromGuideDocument = motion.guidePointDocument;
    motion.travel = null;
    if (
      motion.activeCard !== null &&
      motion.isMobile === isMobile &&
      fromPhone &&
      fromGuideDocument &&
      !prefersReducedMotion
    ) {
      motion.travel = {
        fromPhone,
        fromGuideDocument,
        lastPhoneBounds: motion.phoneBounds ?? target.phoneBounds,
        startedAt: performance.now(),
        duration: getConnectorTravelDuration(
          Math.max(
            getConnectorPointDistance(fromPhone, destinationPhonePoint),
            getConnectorPointDistance(fromGuideDocument, destinationGuideDocumentPoint),
          ),
        ),
      };
    }
    motion.activeCard = card;
    motion.isMobile = isMobile;
  }
  if (prefersReducedMotion) motion.travel = null;

  let phonePoint = destinationPhonePoint;
  let guideDocumentPoint = destinationGuideDocumentPoint;
  let travelProgress = 1;
  if (motion.travel) {
    const phoneBoundsDeltaX = target.phoneBounds.left - motion.travel.lastPhoneBounds.left;
    const phoneBoundsDeltaY = target.phoneBounds.top - motion.travel.lastPhoneBounds.top;
    motion.travel.fromPhone = {
      x: motion.travel.fromPhone.x + phoneBoundsDeltaX,
      y: motion.travel.fromPhone.y + phoneBoundsDeltaY,
    };
    motion.travel.lastPhoneBounds = target.phoneBounds;

    travelProgress = Math.min(1, Math.max(0, (performance.now() - motion.travel.startedAt) / motion.travel.duration));
    const easedProgress = 1 - (1 - travelProgress) ** 3;
    phonePoint = interpolateConnectorPoint(motion.travel.fromPhone, destinationPhonePoint, easedProgress);
    guideDocumentPoint = interpolateConnectorPoint(
      motion.travel.fromGuideDocument,
      destinationGuideDocumentPoint,
      easedProgress,
    );
    if (travelProgress >= 1) motion.travel = null;
  }

  motion.phonePoint = phonePoint;
  motion.guidePointDocument = guideDocumentPoint;
  motion.phoneBounds = target.phoneBounds;

  const guideX = guideDocumentPoint.x - window.scrollX;
  const guideY = guideDocumentPoint.y - window.scrollY;
  const phoneX = phonePoint.x;
  const phoneY = phonePoint.y;
  let connectorPath: string;
  if (isMobile) {
    const caption = getVisibleElement("[data-landing-phone-caption]");
    const captionBounds = caption ? toPhoneRect(caption.getBoundingClientRect()) : null;
    const rightExitX = Math.min(
      window.innerWidth - 4,
      Math.max(Math.max(target.phoneBounds.right, captionBounds?.right ?? target.phoneBounds.right) + 14, guideX + 16),
    );
    const routeBottom = guideY - PHONE_MOBILE_GUIDE_ROUTE_OFFSET;
    const obstaclesBottom = Math.max(target.phoneBounds.bottom, captionBounds?.bottom ?? target.phoneBounds.bottom);
    if (rightExitX <= phoneX || routeBottom < obstaclesBottom + 2 || guideY >= window.innerHeight) {
      clearConnector(path, dot, guideNode, motion);
      return false;
    }
    connectorPath =
      `M ${phoneX} ${phoneY} ` +
      `C ${rightExitX} ${phoneY}, ${rightExitX} ${phoneY}, ${rightExitX} ${phoneY + 12} ` +
      `L ${rightExitX} ${routeBottom - 8} ` +
      `Q ${rightExitX} ${routeBottom}, ${rightExitX - 8} ${routeBottom} ` +
      `L ${guideX + 8} ${routeBottom} ` +
      `Q ${guideX} ${routeBottom}, ${guideX} ${guideY}`;
  } else {
    connectorPath =
      `M ${guideX} ${guideY} ` + `C ${guideX - 82} ${guideY}, ${phoneX + 86} ${phoneY}, ${phoneX} ${phoneY}`;
  }

  path.setAttribute("d", connectorPath);
  dot.setAttribute("cx", `${phoneX}`);
  dot.setAttribute("cy", `${phoneY}`);
  dot.setAttribute("visibility", "visible");
  guideNode.setAttribute("cx", `${guideX}`);
  guideNode.setAttribute("cy", `${guideY}`);
  guideNode.setAttribute("r", `${3 + (motion.travel ? Math.sin(Math.PI * travelProgress) * 1.2 : 0)}`);
  guideNode.setAttribute("visibility", "visible");
  return motion.travel !== null;
}

function getConnectorPointDistance(from: ConnectorPoint, to: ConnectorPoint) {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

function getConnectorTravelDuration(distance: number) {
  return Math.min(
    CONNECTOR_TRAVEL_MAX_DURATION_MS,
    CONNECTOR_TRAVEL_BASE_DURATION_MS + distance * CONNECTOR_TRAVEL_DISTANCE_DURATION_MS_PER_PX,
  );
}

function interpolateConnectorPoint(from: ConnectorPoint, to: ConnectorPoint, progress: number): ConnectorPoint {
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
  };
}
