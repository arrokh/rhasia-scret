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
  const updateLayoutRef = useRef<() => void>(() => undefined);

  useLayoutEffect(() => {
    const heroSection = document.querySelector<HTMLElement>("[data-landing-phone-story-hero]");
    const journeySection = document.querySelector<HTMLElement>("[data-landing-phone-story-journey]");
    const heroAnchor = document.querySelector<HTMLElement>('[data-landing-phone-anchor="hero"]');
    const stage = document.querySelector<HTMLElement>("[data-landing-primary-phone]");
    if (!heroSection || !journeySection || !heroAnchor || !stage) return;

    const initialJourneyAnchor = Array.from(
      document.querySelectorAll<HTMLElement>('[data-landing-phone-anchor="journey"]'),
    ).find((anchor) => anchor.getClientRects().length > 0);
    let journeyAnchorOffset = initialJourneyAnchor
      ? initialJourneyAnchor.getBoundingClientRect().top - journeySection.getBoundingClientRect().top
      : 0;

    let animationFrame = 0;
    let disposed = false;

    const getVisibleJourneyAnchor = () =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-landing-phone-anchor="journey"]')).find(
        (anchor) => anchor.getClientRects().length > 0,
      );

    const updateActiveView = () => {
      const isMobile = window.innerWidth <= 720;
      const viewportCenter = window.innerHeight * (isMobile ? 0.78 : 0.5);
      const activeCard = Array.from(document.querySelectorAll<HTMLElement>("[data-landing-phone-view]"))
        .filter((card) => card.getClientRects().length > 0)
        .map((card) => {
          const bounds = card.getBoundingClientRect();
          const nearestPoint = Math.max(bounds.top, Math.min(viewportCenter, bounds.bottom));
          return { card, distance: Math.abs(nearestPoint - viewportCenter) };
        })
        .filter(({ card }) => {
          const bounds = card.getBoundingClientRect();
          return bounds.bottom > 0 && bounds.top < window.innerHeight;
        })
        .sort((first, second) => first.distance - second.distance)[0]?.card;
      const nextView = activeCard?.dataset.landingPhoneView;
      if (nextView && phoneViews.includes(nextView as LandingPhoneView)) {
        setActiveView((current) => (current === nextView ? current : (nextView as LandingPhoneView)));
      }
    };

    const updateLayout = () => {
      if (disposed) return;
      const journeyAnchor = getVisibleJourneyAnchor();
      if (!journeyAnchor) return;

      const scrollY = window.scrollY;
      const heroRect = heroAnchor.getBoundingClientRect();
      const journeyRect = journeyAnchor.getBoundingClientRect();
      const heroStoryRect = heroSection.getBoundingClientRect();
      const journeyStoryRect = journeySection.getBoundingClientRect();
      const isMobile = window.innerWidth <= 720;
      const sceneStep = heroSection.dataset.sceneStep;
      const shouldHandoff = journeyStoryRect.top < window.innerHeight && journeyStoryRect.bottom > 0;
      if (storyStageStartedRef.current !== shouldHandoff) {
        storyStageStartedRef.current = shouldHandoff;
        setStoryStageStarted(shouldHandoff);
      }
      if (!shouldHandoff) {
        const shouldMoveToJourneySide = sceneStep === "leaving" || sceneStep === "settled";
        const centerX = shouldMoveToJourneySide ? heroRect.left + heroRect.width / 2 : window.innerWidth / 2;
        stage.style.left = `${centerX - window.innerWidth / 2}px`;
        stage.style.top = "0px";
        stage.style.width = `${window.innerWidth}px`;
        stage.style.height = `${window.innerHeight}px`;
        updateConnector(stage, connectorPathRef.current, connectorDotRef.current, isMobile);
        return;
      }

      if (journeyRect.top < window.innerHeight && journeyStoryRect.top > 0) {
        journeyAnchorOffset = journeyRect.top - journeyStoryRect.top;
      }

      const heroStartY = heroStoryRect.top + scrollY + heroSection.clientHeight * 0.46;
      const journeyDocTop = journeyStoryRect.top + scrollY + journeyAnchorOffset;
      const journeyDockY = window.innerHeight * (isMobile ? 0.015 : 0.11);
      const journeyEndY = Math.max(heroStartY + 1, journeyDocTop - journeyDockY);
      const progress = Math.min(1, Math.max(0, (scrollY - heroStartY) / (journeyEndY - heroStartY)));
      const easedProgress = 1 - (1 - progress) ** 3;

      let left = heroRect.left + heroRect.width / 2 - window.innerWidth / 2;
      let top = 0;
      if (progress > 0) {
        left += (journeyRect.left + journeyRect.width / 2 - window.innerWidth / 2 - left) * easedProgress;
        top = (journeyRect.top + journeyRect.height / 2 - window.innerHeight / 2) * easedProgress;
      }

      stage.style.left = `${left}px`;
      stage.style.top = `${top}px`;
      stage.style.width = `${window.innerWidth}px`;
      stage.style.height = `${window.innerHeight}px`;

      updateConnector(stage, connectorPathRef.current, connectorDotRef.current, isMobile);
    };

    const scheduleUpdate = () => {
      if (animationFrame !== 0) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        updateActiveView();
        updateLayout();
      });
    };

    updateLayoutRef.current = updateLayout;
    scheduleUpdate();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    const resizeObserver = new ResizeObserver(scheduleUpdate);
    const targetObserver = new MutationObserver(scheduleUpdate);
    targetObserver.observe(heroSection, {
      attributes: true,
      attributeFilter: ["data-scene-step"],
    });
    {
      targetObserver.observe(stage, {
        subtree: true,
        attributes: true,
        attributeFilter: ["data-landing-target-x", "data-landing-target-y"],
      });
    }
    resizeObserver.observe(heroSection);
    resizeObserver.observe(journeySection);

    return () => {
      disposed = true;
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      resizeObserver.disconnect();
      targetObserver.disconnect();
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
          <path ref={connectorPathRef} />
          <circle ref={connectorDotRef} r="4" />
        </svg>
      </LandingPhoneStoryContext.Provider>
    </LandingPhoneStoryStartedContext.Provider>
  );
}

function updateConnector(
  stage: HTMLElement,
  path: SVGPathElement | null,
  dot: SVGCircleElement | null,
  isMobile: boolean,
) {
  if (!path || !dot) return;
  const card = isMobile
    ? document.querySelector<HTMLElement>('[data-landing-phone-guide="mobile"][data-active="true"]')
    : document.querySelector<HTMLElement>('[data-landing-phone-guide="right"][data-active="true"]');
  const screen = stage.querySelector<HTMLElement>("[data-landing-target-x][data-landing-target-y]");
  const targetX = Number(screen?.dataset.landingTargetX);
  const targetY = Number(screen?.dataset.landingTargetY);
  if (!card || !screen || !Number.isFinite(targetX) || !Number.isFinite(targetY) || stage.dataset.visible !== "true") {
    path.setAttribute("d", "");
    dot.setAttribute("visibility", "hidden");
    return;
  }

  const cardRect = card.getBoundingClientRect();
  if (cardRect.bottom <= 0 || cardRect.top >= window.innerHeight) {
    path.setAttribute("d", "");
    dot.setAttribute("visibility", "hidden");
    return;
  }

  let startX: number;
  let startY: number;
  let controlOneX: number;
  let controlOneY: number;
  let controlTwoX: number;
  let controlTwoY: number;
  if (isMobile) {
    startX = Math.min(cardRect.right - 28, Math.max(cardRect.left + 28, targetX));
    startY = cardRect.top;
    controlOneX = startX;
    controlOneY = startY - 44;
    controlTwoX = targetX;
    controlTwoY = targetY + 52;
  } else {
    startX = cardRect.left;
    startY = Math.min(cardRect.bottom - 24, Math.max(cardRect.top + 24, targetY));
    controlOneX = startX - 78;
    controlOneY = startY;
    controlTwoX = targetX + 86;
    controlTwoY = targetY;
  }

  path.setAttribute(
    "d",
    `M ${startX} ${startY} C ${controlOneX} ${controlOneY}, ${controlTwoX} ${controlTwoY}, ${targetX} ${targetY}`,
  );
  dot.setAttribute("cx", `${targetX}`);
  dot.setAttribute("cy", `${targetY}`);
  dot.setAttribute("visibility", "visible");
}
