"use client";

import { useTranslations } from "next-intl";
import { Check, LockKeyhole, ScanLine, ShieldCheck, UsersRound } from "lucide-react";
import { LandingStoryEnvironment } from "@/modules/landing/presentation/landing-phone-mockup";
import { useLandingPhoneStory, useLandingPhoneStoryStarted } from "@/modules/landing/presentation/landing-phone-story";
import { landingFlowConfig } from "./landing-flow.config";
import styles from "./landing-experience.module.css";

const journeySteps = landingFlowConfig.journey.steps;

export function LandingJourney() {
  const t = useTranslations("Home.landing.journey");
  const activeView = useLandingPhoneStory();
  const storyStarted = useLandingPhoneStoryStarted();
  const activeMobileStep = journeySteps.find((step) => step.phoneView === activeView) ?? journeySteps[0];
  const activeMobileIndex = journeySteps.indexOf(activeMobileStep);

  return (
    <>
      <LandingStoryEnvironment active />
      <section
        id="landing-journey"
        className={`landing-shell ${styles.journey}`}
        aria-label={t("title")}
        aria-hidden={!storyStarted}
        inert={!storyStarted}
        data-landing-phone-story-journey
      >
        <div className={styles.journeyIntro}>
          <h2 id="landing-journey-title" tabIndex={-1}>
            {t("title")}
          </h2>
          <p>{t("description")}</p>
        </div>
        <div className={styles.journeyGrid}>
          <div className={styles.journeyPhoneColumn} role="group" aria-label={t("phoneStageLabel")}>
            <div className={styles.journeyPhoneSticky}>
              <div
                data-landing-phone-anchor="journey"
                className={`${styles.phoneScene} ${styles.phoneSceneJourney} ${styles.phoneAnchor}`}
                aria-hidden="true"
              />
              <div className={styles.journeyPhoneCaption} data-landing-phone-caption>
                <span className={styles.liveDot} aria-hidden="true" />
                <span>{t(`phoneCaption.${activeView}`)}</span>
              </div>
            </div>
          </div>
          <div className={styles.guideColumn}>
            {journeySteps.map((step, index) => (
              <JourneyCard
                key={`${step.id}-right`}
                step={step}
                side="right"
                instance="desktop"
                index={index}
                t={t}
                isActive={step.phoneView === activeView}
              />
            ))}
          </div>
        </div>

        <div className={styles.mobileJourney}>
          <div className={styles.mobileJourneyStage} data-landing-mobile-stage>
            <div className={styles.mobileJourneyPhone} role="group" aria-label={t("phoneStageLabel")}>
              <div
                data-landing-phone-anchor="journey"
                className={`${styles.phoneScene} ${styles.phoneSceneJourney} ${styles.phoneAnchor}`}
                aria-hidden="true"
              />
              <div className={styles.journeyPhoneCaption} data-landing-phone-caption>
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

        <p className={styles.journeyNote} data-landing-phone-story-end>
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
  const entranceDelay = `${Math.min(index, 2) * 60}ms`;
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
      style={{ animationDelay: entranceDelay }}
    >
      <span className={styles.cardIndex}>{`0${index + 1}`}</span>
      <div className={styles.journeyCardContent} style={{ animationDelay: entranceDelay }}>
        <span className={styles.cardIcon}>{marker}</span>
        <p className={styles.cardEyebrow}>{t(`steps.${step.id}.eyebrow`)}</p>
        <h3>{t(`steps.${step.id}.${side}.title`)}</h3>
        <p className={styles.cardDescription}>{t(`steps.${step.id}.${side}.description`)}</p>
        {showNote && <p className={styles.cardNote}>{t(`steps.${step.id}.note`)}</p>}
      </div>
    </article>
  );
}
