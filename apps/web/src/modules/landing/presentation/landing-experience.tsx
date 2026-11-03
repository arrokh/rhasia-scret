"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, TransitionEvent as ReactTransitionEvent } from "react";
import { ArrowUpRight, Cloud, Laptop, LogIn } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { AppFooterContent } from "@/shared/presentation/app-ui";
import { LandingDeviceShowcase, LandingPhoneMockup } from "./landing-phone-mockup";
import { LandingJourney } from "./landing-journey";
import { LandingLanguageDialog } from "./landing-language-dialog";
import { LandingPhoneStoryProvider, useLandingPhoneStory, useLandingPhoneStoryStarted } from "./landing-phone-story";
import { landingFlowConfig, type LandingSceneStep } from "./landing-flow.config";
import styles from "./landing-desktop-scene.module.css";
import experienceStyles from "./landing-experience.module.css";

const { durationsMs, input, processingStates, states, transitions } = landingFlowConfig.intro;
const initialPhoneView = landingFlowConfig.journey.steps[0]?.phoneView ?? "accounts";
const sceneTimingStyle = {
  "--landing-showcase-expansion-duration": `${durationsMs.showcaseExpansion}ms`,
  "--landing-device-transition-duration": `${durationsMs.deviceTransition}ms`,
  "--landing-device-departure-delay": `${durationsMs.deviceDepartureDelay}ms`,
} as CSSProperties;

function getSceneTransition(from: LandingSceneStep, trigger: string) {
  return transitions.find((transition) => transition.from === from && transition.trigger === trigger)?.to;
}

function isProcessingStep(step: LandingSceneStep) {
  return input.ignoreDuringProcessing && processingStates.includes(step);
}

export function LandingExperience() {
  return (
    <LandingPhoneStoryProvider>
      <LandingExperienceContent />
    </LandingPhoneStoryProvider>
  );
}

function LandingExperienceContent() {
  const [unlockDemoStarted, setUnlockDemoStarted] = useState(false);
  const [unlockDemoResetToken, setUnlockDemoResetToken] = useState(0);
  const [sceneStep, setSceneStep] = useState<LandingSceneStep>(landingFlowConfig.intro.initialState);
  const [showShowcase, setShowShowcase] = useState(false);
  const [showcaseReady, setShowcaseReady] = useState(false);
  const [showInitialPhone, setShowInitialPhone] = useState(true);
  const [showcaseTargetProgress, setShowcaseTargetProgress] = useState(0);
  const [heroVisible, setHeroVisible] = useState(false);
  const sceneSectionRef = useRef<HTMLElement | null>(null);
  const sceneStepRef = useRef<LandingSceneStep>(landingFlowConfig.intro.initialState);
  const languageDialogOpenRef = useRef(true);
  const handleLanguageDialogOpenChange = useCallback((open: boolean) => {
    languageDialogOpenRef.current = open;
  }, []);
  const wheelGestureActiveRef = useRef(false);
  const wheelGestureDirectionRef = useRef<number | null>(null);
  const wheelGestureReleaseTimerRef = useRef<number | null>(null);
  const sceneStepTimerRef = useRef<number | null>(null);
  const t = useTranslations("Home.landing");
  const journeyT = useTranslations("Home.landing.journey");
  const commonT = useTranslations("Common");
  const storyStageStarted = useLandingPhoneStoryStarted();
  const storyView = useLandingPhoneStory();
  const setSceneStepValue = useCallback((nextStep: LandingSceneStep) => {
    sceneStepRef.current = nextStep;
    setSceneStep(nextStep);
  }, []);
  const handleUnlockComplete = useCallback(() => {
    if (sceneStepRef.current !== "unlocking") return;
    const nextStep = getSceneTransition(sceneStepRef.current, "unlock-animation-complete");
    if (!nextStep) return;
    setShowShowcase(true);
    setSceneStepValue(nextStep);
  }, [setSceneStepValue]);
  const completeReverseTransition = useCallback(() => {
    if (sceneStepRef.current !== "contracting") return;
    if (sceneStepTimerRef.current !== null) {
      window.clearTimeout(sceneStepTimerRef.current);
      sceneStepTimerRef.current = null;
    }
    const nextStep = getSceneTransition("contracting", "showcase-transition-complete");
    if (nextStep) setSceneStepValue(nextStep);
  }, [setSceneStepValue]);
  const handleInitialPhoneTransitionEnd = useCallback(
    (event: ReactTransitionEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget || event.propertyName !== "transform") return;
      completeReverseTransition();
    },
    [completeReverseTransition],
  );
  const handleShowcaseReady = useCallback(() => {
    setShowcaseReady(true);
    if (sceneStepRef.current !== "expanding") return;
    setShowInitialPhone(false);
    setHeroVisible(true);
    setShowcaseTargetProgress(0.5);
  }, []);
  const handleShowcaseTransitionComplete = useCallback(() => {
    if (sceneStepRef.current === "expanding") {
      const nextStep = getSceneTransition(sceneStepRef.current, "showcase-transition-complete");
      if (nextStep) setSceneStepValue(nextStep);
      return;
    }
    if (sceneStepRef.current === "contracting") {
      setShowInitialPhone(true);
      setShowShowcase(false);
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reducedMotion) {
        completeReverseTransition();
        return;
      }
      sceneStepTimerRef.current = window.setTimeout(completeReverseTransition, durationsMs.showcaseExpansion + 100);
      return;
    }
    if (sceneStepRef.current === "leaving") {
      const nextStep = getSceneTransition(sceneStepRef.current, "phone-handoff-complete");
      if (!nextStep) return;
      setSceneStepValue(nextStep);
      return;
    }
    if (sceneStepRef.current === "returning") {
      const nextStep = getSceneTransition(sceneStepRef.current, "showcase-transition-complete");
      if (nextStep) setSceneStepValue(nextStep);
    }
  }, [completeReverseTransition, setSceneStepValue]);

  const triggerNextStep = useCallback(() => {
    const nextStep = sceneStepRef.current;
    if (nextStep === "locked") {
      const targetStep = getSceneTransition(nextStep, "scroll-down");
      if (!targetStep) return;
      setSceneStepValue(targetStep);
      setUnlockDemoStarted(true);
      setShowShowcase(true);
      return;
    }
    if (nextStep === "unlocked") {
      const targetStep = getSceneTransition(nextStep, "scroll-down");
      if (!targetStep) return;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reducedMotion) {
        setShowInitialPhone(false);
        setHeroVisible(true);
        setShowcaseTargetProgress(0.5);
        setShowShowcase(true);
        const devicesStep = getSceneTransition(targetStep, "showcase-transition-complete");
        if (devicesStep) setSceneStepValue(devicesStep);
        return;
      }

      setSceneStepValue(targetStep);
      setShowcaseTargetProgress(showcaseReady ? 0.5 : 0);
      if (showcaseReady) {
        setShowInitialPhone(false);
        setHeroVisible(true);
      }
      setShowShowcase(true);
      return;
    }
    if (nextStep === "devices") {
      const targetStep = getSceneTransition(nextStep, "scroll-down");
      if (!targetStep) return;
      setSceneStepValue(targetStep);
      setHeroVisible(false);
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      sceneStepTimerRef.current = window.setTimeout(
        () => setShowcaseTargetProgress(1),
        reducedMotion ? 0 : durationsMs.deviceDepartureDelay,
      );
      return;
    }
    return;
  }, [setSceneStepValue, showcaseReady]);

  const triggerPreviousStep = useCallback(() => {
    const currentStep = sceneStepRef.current;
    if (currentStep === "locked") return;
    if (currentStep === "unlocked") {
      const targetStep = getSceneTransition(currentStep, "scroll-up");
      if (!targetStep) return;
      setUnlockDemoStarted(false);
      setUnlockDemoResetToken((token) => token + 1);
      setShowShowcase(false);
      setSceneStepValue(targetStep);
      return;
    }
    if (currentStep === "devices") {
      const targetStep = getSceneTransition(currentStep, "scroll-up");
      if (!targetStep) return;
      setSceneStepValue(targetStep);
      setHeroVisible(false);
      setShowcaseTargetProgress(0);
      return;
    }
    if (currentStep !== "settled" || window.scrollY > 1) return;

    const targetStep = getSceneTransition(currentStep, "scroll-up-at-page-top");
    if (!targetStep) return;
    setSceneStepValue(targetStep);
    setHeroVisible(true);
    setShowcaseTargetProgress(0.5);
  }, [setSceneStepValue]);

  useEffect(() => {
    const sceneSection = sceneSectionRef.current;
    const isTransitioning = () => isProcessingStep(sceneStepRef.current);
    const isAtTop = () => window.scrollY <= 1;
    const getKeyboardDirection = (event: KeyboardEvent) => {
      const matchesKey = (key: string) => (key === "Space" ? event.key === " " : event.key === key);
      if (input.forwardKeys.some(matchesKey)) return 1;
      if (input.backwardKeys.some(matchesKey)) return -1;
      return 0;
    };
    const isInteractiveKeyboardTarget = (event: KeyboardEvent) => {
      if (!(event.target instanceof Element)) return false;
      if (
        event.target.closest(
          "input, select, textarea, [role=textbox], [role=combobox], [role=searchbox], [role=spinbutton], [contenteditable]:not([contenteditable='false'])",
        )
      )
        return true;
      return event.key === " " && event.target.closest("button, a, [role=button], [role=link]") !== null;
    };
    const canScrollIntroContentInDirection = (target: EventTarget | null, direction: number) => {
      if (!(target instanceof Element)) return false;
      const scrollContainer = target.closest<HTMLElement>("[data-landing-intro-scroll]");
      if (!scrollContainer) return false;
      if (direction > 0) {
        return scrollContainer.scrollTop + scrollContainer.clientHeight < scrollContainer.scrollHeight - 1;
      }
      return scrollContainer.scrollTop > 1;
    };
    let touchStartY: number | null = null;
    let touchStartAtTop = false;
    let touchGestureActive = false;
    let touchScrollContainer: HTMLElement | null = null;
    const resetTouchGesture = () => {
      touchStartY = null;
      touchStartAtTop = false;
      touchGestureActive = false;
      touchScrollContainer = null;
    };
    const releaseWheelGestureSoon = () => {
      if (wheelGestureReleaseTimerRef.current !== null) {
        window.clearTimeout(wheelGestureReleaseTimerRef.current);
      }
      wheelGestureReleaseTimerRef.current = window.setTimeout(() => {
        wheelGestureActiveRef.current = false;
        wheelGestureDirectionRef.current = null;
        wheelGestureReleaseTimerRef.current = null;
      }, input.wheelGestureReleaseMs);
    };
    const noteWheelGesture = (direction: number) => {
      const alreadyActiveInDirection = wheelGestureActiveRef.current && wheelGestureDirectionRef.current === direction;
      if (!alreadyActiveInDirection) {
        wheelGestureActiveRef.current = true;
        wheelGestureDirectionRef.current = direction;
      }
      releaseWheelGestureSoon();
      return alreadyActiveInDirection;
    };
    const noteWheelGestureDuringTransition = (direction: number) => {
      wheelGestureActiveRef.current = true;
      wheelGestureDirectionRef.current = direction;
      releaseWheelGestureSoon();
    };
    const blockProcessingInput = (event: Event) => {
      if (languageDialogOpenRef.current || !isTransitioning()) return;
      if (event.type === "keydown") {
        const keyboardEvent = event as KeyboardEvent;
        if (getKeyboardDirection(keyboardEvent) === 0 || isInteractiveKeyboardTarget(keyboardEvent)) return;
      }
      if (event.type === "touchstart" || event.type === "touchend" || event.type === "touchcancel") {
        resetTouchGesture();
      }
      if (event.type === "scroll" && window.scrollY > 1) {
        window.scrollTo({ top: 0, behavior: "instant" });
      }
      if (event.type === "wheel") {
        const wheelEvent = event as WheelEvent;
        if (wheelEvent.deltaY !== 0) noteWheelGestureDuringTransition(wheelEvent.deltaY > 0 ? 1 : -1);
      }
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
    };
    const blockedEvents = [
      "keydown",
      "pointerdown",
      "pointerup",
      "pointermove",
      "mousedown",
      "mouseup",
      "mousemove",
      "click",
      "auxclick",
      "dblclick",
      "contextmenu",
      "dragstart",
      "wheel",
      "touchstart",
      "touchmove",
      "touchend",
      "touchcancel",
      "scroll",
    ];

    const handleWheel = (event: WheelEvent) => {
      if (languageDialogOpenRef.current || event.deltaY === 0) return;
      const direction = event.deltaY > 0 ? 1 : -1;
      if (canScrollIntroContentInDirection(event.target, direction)) return;
      const currentStep = sceneStepRef.current;
      if (currentStep === "settled" && (direction > 0 || !isAtTop())) {
        noteWheelGesture(direction);
        return;
      }
      event.preventDefault();
      if (noteWheelGesture(direction) || isTransitioning()) return;
      if (direction > 0) {
        if (currentStep !== "settled") triggerNextStep();
        return;
      }
      triggerPreviousStep();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (languageDialogOpenRef.current) return;
      const direction = getKeyboardDirection(event);
      if (direction === 0 || isInteractiveKeyboardTarget(event)) return;
      if (canScrollIntroContentInDirection(event.target, direction)) return;
      const currentStep = sceneStepRef.current;
      if (currentStep === "settled" && (direction > 0 || !isAtTop())) return;
      event.preventDefault();
      if (event.repeat || isTransitioning()) return;
      if (direction > 0) {
        if (currentStep !== "settled") triggerNextStep();
        return;
      }
      triggerPreviousStep();
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (languageDialogOpenRef.current) return;
      touchStartY = event.touches[0]?.clientY ?? null;
      touchStartAtTop = isAtTop();
      touchGestureActive = false;
      touchScrollContainer =
        event.target instanceof Element ? event.target.closest<HTMLElement>("[data-landing-intro-scroll]") : null;
    };
    const handleTouchMove = (event: TouchEvent) => {
      if (languageDialogOpenRef.current || touchStartY === null) return;
      const currentY = event.touches[0]?.clientY;
      if (currentY === undefined) return;
      const deltaY = touchStartY - currentY;
      if (Math.abs(deltaY) < input.touchThresholdPx) return;
      const direction = deltaY > 0 ? 1 : -1;
      if (touchScrollContainer && canScrollIntroContentInDirection(touchScrollContainer, direction)) return;
      const currentStep = sceneStepRef.current;
      const isBackwardAtTop = currentStep === "settled" && deltaY < 0 && touchStartAtTop && isAtTop();
      if (currentStep === "settled" && !isBackwardAtTop) return;
      event.preventDefault();
      if (touchGestureActive) return;
      touchGestureActive = true;
      if (isTransitioning()) return;
      if (direction > 0) {
        if (currentStep !== "settled") triggerNextStep();
        return;
      }
      triggerPreviousStep();
    };
    const handleTouchEnd = () => resetTouchGesture();
    const keepIntroAtTop = () => {
      if (languageDialogOpenRef.current) return;
      if (sceneStepRef.current !== "settled" && window.scrollY > 0) {
        window.scrollTo({ top: 0, behavior: "instant" });
      }
    };

    for (const eventName of blockedEvents) {
      window.addEventListener(eventName, blockProcessingInput, { capture: true, passive: false });
    }
    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", handleTouchEnd, { passive: true });
    window.addEventListener("scroll", keepIntroAtTop, { passive: true });
    sceneSection?.setAttribute("data-input-ready", "true");
    return () => {
      for (const eventName of blockedEvents) {
        window.removeEventListener(eventName, blockProcessingInput, true);
      }
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
      window.removeEventListener("scroll", keepIntroAtTop);
      sceneSection?.setAttribute("data-input-ready", "false");
    };
  }, [triggerNextStep, triggerPreviousStep]);

  useEffect(() => {
    return () => {
      if (wheelGestureReleaseTimerRef.current !== null) {
        window.clearTimeout(wheelGestureReleaseTimerRef.current);
      }
      if (sceneStepTimerRef.current !== null) window.clearTimeout(sceneStepTimerRef.current);
    };
  }, []);

  const initialPhoneVisible = showInitialPhone || showShowcase || sceneStep === "settled" || storyStageStarted;
  const showcaseCameraActive = ["expanding", "devices", "returning"].includes(sceneStep);
  const showcaseFloorActive = ["expanding", "devices", "contracting", "leaving", "returning"].includes(sceneStep);
  const primaryPhoneScale = showShowcase && showcaseCameraActive && !storyStageStarted ? "showcase" : "full";
  const heroOnScreen = heroVisible;
  const sceneAnimating = isProcessingStep(sceneStep);
  const currentSceneConfig = states.find((state) => state.id === sceneStep);
  const topScrollReady = currentSceneConfig?.scrollHint === "top";
  const bottomScrollReady = currentSceneConfig?.scrollHint === "hero" && heroOnScreen;
  const showcaseTransitionDuration =
    sceneStep === "expanding" || sceneStep === "contracting"
      ? durationsMs.showcaseExpansion
      : sceneStep === "leaving" || sceneStep === "returning"
        ? durationsMs.deviceTransition
        : 0;

  return (
    <main className={experienceStyles.page}>
      <LandingLanguageDialog onOpenChange={handleLanguageDialogOpenChange} />
      <div
        data-landing-primary-phone
        className={styles.initialPhone}
        data-visible={initialPhoneVisible}
        data-device-scale={primaryPhoneScale}
        data-scene-step={sceneStep}
        data-story-handoff={storyStageStarted}
        aria-hidden={!initialPhoneVisible}
        style={sceneTimingStyle}
        onTransitionEnd={handleInitialPhoneTransitionEnd}
      >
        <LandingPhoneMockup
          view={storyStageStarted ? storyView : initialPhoneView}
          layout="scene"
          transparentFloor={
            (showShowcase && showcaseReady && showcaseFloorActive) || sceneStep === "settled" || storyStageStarted
          }
          startUnlockDemo={unlockDemoStarted}
          unlockDemoResetToken={unlockDemoResetToken}
          onUnlockComplete={handleUnlockComplete}
        />
      </div>
      <div
        data-landing-device-showcase="true"
        className={styles.deviceShowcase}
        data-ready={showcaseReady}
        data-visible={
          showShowcase && showcaseReady && sceneStep !== "unlocking" && sceneStep !== "unlocked" && !storyStageStarted
        }
        aria-hidden={
          !showShowcase || !showcaseReady || sceneStep === "unlocking" || sceneStep === "unlocked" || storyStageStarted
        }
        inert={
          !showShowcase || !showcaseReady || sceneStep === "unlocking" || sceneStep === "unlocked" || storyStageStarted
        }
      >
        <LandingDeviceShowcase
          progress={showcaseTargetProgress}
          transitionDuration={showcaseTransitionDuration}
          onReady={handleShowcaseReady}
          onTransitionComplete={handleShowcaseTransitionComplete}
        />
      </div>
      <section
        ref={sceneSectionRef}
        className={styles.scenePage}
        data-landing-desktop-scene="true"
        data-landing-phone-story-hero
        data-story-handoff={storyStageStarted}
        data-input-ready="false"
        data-scene-step={sceneStep}
        style={sceneTimingStyle}
        aria-busy={sceneAnimating}
        aria-label={t("phone.hostedPreview")}
      >
        <div className={styles.sceneStage}>
          <div data-landing-phone-anchor="hero" className={styles.heroPhoneAnchor} aria-hidden="true" />

          <div className={styles.scrollCue} data-hidden={!topScrollReady} aria-hidden={!topScrollReady}>
            <ScrollArrow />
            <span>{journeyT("scrollPrompt")}</span>
          </div>

          <section
            className={styles.heroOverlay}
            data-landing-intro-scroll="true"
            data-visible={heroOnScreen}
            aria-hidden={!heroOnScreen}
            inert={!heroOnScreen || sceneAnimating}
            tabIndex={0}
          >
            <p className={experienceStyles.eyebrow}>{t("eyebrow")}</p>
            <h1 className={`${experienceStyles.heroTitle} ${styles.sceneHeroTitle}`}>{t("title")}</h1>
            <p className={`${experienceStyles.heroDescription} ${styles.sceneHeroDescription}`}>{t("description")}</p>
            <div className={`${experienceStyles.heroActions} ${styles.sceneHeroActions}`}>
              <div className={`${experienceStyles.heroButtonRow} ${styles.sceneHeroButtonRow}`}>
                <Button asChild>
                  <Link href="/local?from=landing">
                    <Laptop aria-hidden="true" />
                    {t("localVault")}
                  </Link>
                </Button>
                <span className={experienceStyles.choiceSeparator}>{t("choiceSeparator")}</span>
                <Button asChild className="bg-[#1b252c] text-card hover:bg-[#2b3a44] active:bg-[#11181d]">
                  <Link href="/sign-in">
                    <Cloud aria-hidden="true" />
                    {t("hostedVault")}
                  </Link>
                </Button>
              </div>
              <p className={`${experienceStyles.hostedAccess} ${styles.sceneHostedAccess}`}>{t("hostedAccess")}</p>
            </div>
          </section>

          <div className={styles.heroScrollCue} data-visible={bottomScrollReady} aria-hidden={!bottomScrollReady}>
            <ScrollArrow />
            <span>{journeyT("scrollPrompt")}</span>
          </div>

          <div
            className={styles.sceneLoadingIndicator}
            data-visible={sceneAnimating}
            role="status"
            aria-label={commonT("processing")}
            aria-hidden={!sceneAnimating}
          >
            <span className={styles.sceneLoadingSpinner} aria-hidden="true" />
            <span>{commonT("processing")}</span>
          </div>
        </div>
      </section>

      <LandingJourney />

      <section className={`landing-shell ${experienceStyles.finalCta}`} data-slot="landing-final-cta">
        <div className={experienceStyles.finalCtaCopy}>
          <p className={experienceStyles.eyebrow}>{t("finalCta.eyebrow")}</p>
          <h2>{t("finalCta.title")}</h2>
          <p>{t("finalCta.description")}</p>
        </div>
        <div className={experienceStyles.finalCtaActions}>
          <Button asChild>
            <Link href="/sign-in">
              {t("finalCta.tryNow")}
              <LogIn aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <a
              href="https://github.com/arrokh/rhasia-scret/blob/main/docs/self-hosting.md"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("finalCta.hostYourOwn")}
              <ArrowUpRight aria-hidden="true" />
            </a>
          </Button>
        </div>
      </section>

      <footer className={experienceStyles.footer}>
        <AppFooterContent />
      </footer>
    </main>
  );
}

function ScrollArrow() {
  return (
    <svg className={styles.scrollDoodle} viewBox="0 0 38 48" fill="none" aria-hidden="true">
      <path
        className={styles.scrollDoodleArrow}
        d="M19 4c-1 10-.2 20 0 31m-9-9c2.5 3 5.7 5.9 9 9 3-3.1 6-6.1 9.4-9.1"
      />
    </svg>
  );
}
