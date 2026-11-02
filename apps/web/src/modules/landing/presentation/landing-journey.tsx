"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, LockKeyhole, ScanLine, ShieldCheck, UsersRound } from "lucide-react";
import { LandingStoryEnvironment } from "@/modules/landing/presentation/landing-phone-mockup";
import { useLandingPhoneStory } from "@/modules/landing/presentation/landing-phone-story";
import { landingFlowConfig } from "./landing-flow.config";
import styles from "./landing-experience.module.css";

const journeySteps = landingFlowConfig.journey.steps;

export function LandingJourneyStartCard() {
  const t = useTranslations("Home.landing.journey");

  return (
    <JourneyCard
      step={journeySteps[0]}
      side="right"
      instance="desktop"
      index={0}
      t={t}
      trackView={false}
      trackGuide={false}
      isActive
    />
  );
}

export function LandingJourney() {
  const t = useTranslations("Home.landing.journey");
  const activeView = useLandingPhoneStory();
  const activeMobileStep = journeySteps.find((step) => step.phoneView === activeView) ?? journeySteps[0];
  const activeMobileIndex = journeySteps.indexOf(activeMobileStep);
  const journeyRef = useRef<HTMLElement>(null);
  const [environmentActive, setEnvironmentActive] = useState(false);

  useEffect(() => {
    const journey = journeyRef.current;
    if (!journey) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const isVisible = Boolean(entry?.isIntersecting && entry.intersectionRatio > 0);
        setEnvironmentActive(isVisible);
      },
      { rootMargin: "-10% 0px -10% 0px" },
    );
    observer.observe(journey);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <LandingStoryEnvironment active={environmentActive} />
      <section
        ref={journeyRef}
        id="landing-journey"
        className={`landing-shell ${styles.journey}`}
        aria-label={t("title")}
        data-landing-phone-story-journey
      >
        <div className={styles.journeyGrid}>
          <div className={styles.journeyPhoneColumn} aria-label={t("phoneStageLabel")}>
            <div className={styles.journeyPhoneSticky}>
              <div
                data-landing-phone-anchor="journey"
                className={`${styles.phoneScene} ${styles.phoneSceneJourney} ${styles.phoneAnchor}`}
                aria-hidden="true"
              />
              <div className={styles.journeyPhoneCaption}>
                <span className={styles.liveDot} aria-hidden="true" />
                <span>{t(`phoneCaption.${activeView}`)}</span>
              </div>
            </div>
          </div>
          <div className={styles.guideColumn}>
            {journeySteps.slice(1).map((step, offset) => (
              <JourneyCard
                key={`${step.id}-right`}
                step={step}
                side="right"
                instance="desktop"
                index={offset + 1}
                t={t}
                isActive={step.phoneView === activeView}
              />
            ))}
          </div>
        </div>

        <div className={styles.mobileJourney}>
          <div className={styles.mobileJourneyStage}>
            <div className={styles.mobileJourneyPhone} aria-label={t("phoneStageLabel")}>
              <div
                data-landing-phone-anchor="journey"
                className={`${styles.phoneScene} ${styles.phoneSceneJourney} ${styles.phoneAnchor}`}
                aria-hidden="true"
              />
              <div className={styles.journeyPhoneCaption}>
                <span className={styles.liveDot} aria-hidden="true" />
                <span>{t(`phoneCaption.${activeView}`)}</span>
              </div>
            </div>
            <div className={styles.mobileJourneyGuide}>
              <JourneyCard
                key={`mobile-panel-${activeMobileStep.id}`}
                step={activeMobileStep}
                side="left"
                instance="mobile"
                index={activeMobileIndex}
                t={t}
                trackView={false}
                isActive
                showNote
              />
            </div>
          </div>
          <div className={styles.mobileJourneySteps}>
            {journeySteps.map((step) => (
              <div
                key={`${step.id}-trigger`}
                data-landing-phone-view={step.phoneView}
                className={styles.mobileJourneyTrigger}
              />
            ))}
          </div>
        </div>

        <p className={styles.journeyNote}>
          <ShieldCheck size={17} aria-hidden="true" />
          <span>{t("privacyNote")}</span>
        </p>
      </section>
    </>
  );
}

function JourneyCard({
  step,
  side,
  instance,
  index,
  t,
  trackView = true,
  trackGuide = true,
  isActive = false,
  showNote = side === "right",
}: {
  step: (typeof journeySteps)[number];
  side: "left" | "right";
  instance: "desktop" | "mobile";
  index: number;
  t: ReturnType<typeof useTranslations>;
  trackView?: boolean;
  trackGuide?: boolean;
  isActive?: boolean;
  showNote?: boolean;
}) {
  const marker =
    index === 0 || index === 4 ? (
      <LockKeyhole aria-hidden="true" />
    ) : index < 4 ? (
      <ScanLine aria-hidden="true" />
    ) : index < 7 ? (
      <UsersRound aria-hidden="true" />
    ) : (
      <Check aria-hidden="true" />
    );

  return (
    <article
      id={trackView ? `landing-step-${step.id}-${instance}-${side}` : undefined}
      data-landing-phone-view={trackView ? step.phoneView : undefined}
      data-landing-phone-guide={trackGuide ? (instance === "mobile" ? "mobile" : side) : undefined}
      data-active={isActive}
      className={`${styles.journeyCard} ${styles[`journeyCard${side === "left" ? "Left" : "Right"}`]}`}
    >
      <span className={styles.cardIndex}>{`0${index + 1}`}</span>
      <span className={styles.cardIcon}>{marker}</span>
      <p className={styles.cardEyebrow}>{t(`steps.${step.id}.eyebrow`)}</p>
      <h3>{t(`steps.${step.id}.${side}.title`)}</h3>
      <p className={styles.cardDescription}>{t(`steps.${step.id}.${side}.description`)}</p>
      {showNote && <p className={styles.cardNote}>{t(`steps.${step.id}.note`)}</p>}
    </article>
  );
}
