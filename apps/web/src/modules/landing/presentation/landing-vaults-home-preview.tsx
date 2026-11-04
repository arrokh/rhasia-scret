"use client";

import { MousePointer2, Settings } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import {
  PersonalVaultAccounts,
  PreviewUnlockedVaultWorkspaceProvider,
  useUnlockedVaultWorkspace,
} from "@/modules/authenticator-account";
import type { UnlockedVaultWorkspace } from "@/modules/sync";
import { ALL_ACCOUNT_PERMISSIONS, effectiveSharedVaultAccountPermissions } from "@/modules/vault-membership";
import { Button } from "@/components/ui/button";
import { AppPage, PageHeader, SurfaceCard } from "@/shared/presentation/app-ui";
import { useLandingPhoneClock } from "./landing-phone-clock";
import { landingFlowConfig } from "./landing-flow.config";
import styles from "./landing-desktop-scene.module.css";

const PERSONAL_VAULT_ID = "landing-preview-personal";

const accountFixtures = [
  { issuerKey: "sampleDemoAppName", accountNameKey: "sampleDemoAppAccountName", secretByte: 19 },
] as const;

const unlockDemo = landingFlowConfig.intro.unlockDemo;
const MASKED_PREVIEW_PASSPHRASE = "•".repeat(unlockDemo.maskedPassphraseLength);

type UnlockDemoPhase =
  "locked" | "cursorReady" | "movingToPassphrase" | "typing" | "movingToUnlock" | "clickingUnlock" | "unlocked";

type UnlockDemoPoint = Readonly<{ x: number; y: number }>;
type UnlockDemoPoints = Readonly<{
  start: UnlockDemoPoint;
  passphrase: UnlockDemoPoint;
  unlock: UnlockDemoPoint;
}>;

export function LandingVaultsHomePreview({
  startUnlockDemo = false,
  unlockDemoResetToken = 0,
  onUnlockComplete,
}: {
  startUnlockDemo?: boolean;
  unlockDemoResetToken?: number;
  onUnlockComplete?: () => void;
}) {
  return (
    <PreviewUnlockedVaultWorkspaceProvider key={unlockDemoResetToken} initialWorkspace={null}>
      <LandingVaultsHomePreviewScreen startUnlockDemo={startUnlockDemo} onUnlockComplete={onUnlockComplete} />
    </PreviewUnlockedVaultWorkspaceProvider>
  );
}

function LandingVaultsHomePreviewScreen({
  startUnlockDemo,
  onUnlockComplete,
}: {
  startUnlockDemo: boolean;
  onUnlockComplete?: () => void;
}) {
  const tVault = useTranslations("VaultManagement.vaultsPage");
  const tLogout = useTranslations("Identity.logout");
  const sample = useTranslations("Preview.authenticatorAccounts");
  const currentPhoneTime = useLandingPhoneClock();
  const { setWorkspace } = useUnlockedVaultWorkspace();
  const phoneUiRef = useRef<HTMLDivElement>(null);
  const onUnlockCompleteRef = useRef(onUnlockComplete);
  const [phase, setPhase] = useState<UnlockDemoPhase>("locked");
  const [previewPassphraseValue, setPreviewPassphraseValue] = useState("");
  const [pointerPoints, setPointerPoints] = useState<UnlockDemoPoints | null>(null);
  useEffect(() => {
    onUnlockCompleteRef.current = onUnlockComplete;
  }, [onUnlockComplete]);

  const previewPersonalVaultName = sample("personalVault");
  const previewAccountIssuer = sample(accountFixtures[0].issuerKey);
  const previewAccountName = sample(accountFixtures[0].accountNameKey);
  const workspace = useMemo(
    () =>
      createPreviewWorkspace(previewPersonalVaultName, [
        {
          issuer: previewAccountIssuer,
          accountName: previewAccountName,
          secret: syntheticSecret(accountFixtures[0].secretByte),
        },
      ]),
    [previewAccountIssuer, previewAccountName, previewPersonalVaultName],
  );
  const workspaceRef = useRef(workspace);
  const setWorkspaceRef = useRef(setWorkspace);
  useEffect(() => {
    workspaceRef.current = workspace;
    setWorkspaceRef.current = setWorkspace;
  }, [setWorkspace, workspace]);

  useLayoutEffect(() => {
    if (!startUnlockDemo) return;
    const phoneUi = phoneUiRef.current;
    const passphraseInput = phoneUi?.querySelector<HTMLInputElement>("[data-landing-demo-passphrase]");
    const unlockButton = phoneUi?.querySelector<HTMLButtonElement>("[data-landing-demo-unlock]");
    if (!phoneUi || !passphraseInput || !unlockButton) return;

    const measurePoints = () => {
      const phoneRect = phoneUi.getBoundingClientRect();
      const passphraseRect = passphraseInput.getBoundingClientRect();
      const unlockRect = unlockButton.getBoundingClientRect();
      setPointerPoints({
        start: { x: phoneRect.width - 42, y: phoneRect.height * 0.27 },
        passphrase: {
          x: passphraseRect.left - phoneRect.left + passphraseRect.width * 0.36,
          y: passphraseRect.top - phoneRect.top + passphraseRect.height / 2,
        },
        unlock: {
          x: unlockRect.left - phoneRect.left + unlockRect.width / 2,
          y: unlockRect.top - phoneRect.top + unlockRect.height / 2,
        },
      });
    };

    measurePoints();
    const resizeObserver = new ResizeObserver(measurePoints);
    resizeObserver.observe(phoneUi);
    resizeObserver.observe(passphraseInput);
    resizeObserver.observe(unlockButton);
    return () => resizeObserver.disconnect();
  }, [startUnlockDemo]);

  useEffect(() => {
    if (!startUnlockDemo) return;
    const animationWindow = window;
    if (animationWindow.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const frameId = animationWindow.requestAnimationFrame(() => {
        setPreviewPassphraseValue(MASKED_PREVIEW_PASSPHRASE);
        setPhase("unlocked");
        setWorkspaceRef.current(workspaceRef.current);
        onUnlockCompleteRef.current?.();
      });
      return () => animationWindow.cancelAnimationFrame(frameId);
    }

    const cursorReadyFrameId = animationWindow.requestAnimationFrame(() => setPhase("cursorReady"));
    const timeouts: number[] = [];
    let typingInterval: number | undefined;
    const typingDuration = MASKED_PREVIEW_PASSPHRASE.length * unlockDemo.characterInterval;
    const typingStart = unlockDemo.startDelay + unlockDemo.cursorTravel;
    const unlockCursorStart = typingStart + typingDuration + unlockDemo.preUnlockPause;
    const unlockClickStart = unlockCursorStart + unlockDemo.cursorTravel;
    const unlockComplete = unlockClickStart + unlockDemo.buttonPress;

    timeouts.push(animationWindow.setTimeout(() => setPhase("movingToPassphrase"), unlockDemo.startDelay));
    timeouts.push(
      animationWindow.setTimeout(() => {
        setPhase("typing");
        let typedCharacters = 0;
        typingInterval = animationWindow.setInterval(() => {
          typedCharacters += 1;
          setPreviewPassphraseValue(MASKED_PREVIEW_PASSPHRASE.slice(0, typedCharacters));
          if (typedCharacters >= MASKED_PREVIEW_PASSPHRASE.length && typingInterval !== undefined) {
            animationWindow.clearInterval(typingInterval);
            typingInterval = undefined;
          }
        }, unlockDemo.characterInterval);
      }, typingStart),
    );
    timeouts.push(animationWindow.setTimeout(() => setPhase("movingToUnlock"), unlockCursorStart));
    timeouts.push(animationWindow.setTimeout(() => setPhase("clickingUnlock"), unlockClickStart));
    timeouts.push(
      animationWindow.setTimeout(() => {
        setPhase("unlocked");
        setWorkspaceRef.current(workspaceRef.current);
        onUnlockCompleteRef.current?.();
      }, unlockComplete),
    );

    return () => {
      animationWindow.cancelAnimationFrame(cursorReadyFrameId);
      for (const timeout of timeouts) animationWindow.clearTimeout(timeout);
      if (typingInterval !== undefined) animationWindow.clearInterval(typingInterval);
    };
  }, [startUnlockDemo]);

  const cursorTarget =
    phase === "cursorReady"
      ? pointerPoints?.start
      : phase === "movingToUnlock" || phase === "clickingUnlock"
        ? pointerPoints?.unlock
        : pointerPoints?.passphrase;

  return (
    <div
      ref={phoneUiRef}
      className={styles.phoneUi}
      data-unlock-phase={phase}
      style={
        {
          "--landing-unlock-cursor-duration": `${unlockDemo.cursorTravel}ms`,
          "--landing-unlock-button-duration": `${unlockDemo.buttonPress}ms`,
          "--landing-unlock-click-feedback-duration": `${unlockDemo.clickFeedback}ms`,
        } as CSSProperties
      }
    >
      <div className={styles.phoneStatusBar}>
        <span>{currentPhoneTime}</span>
        <span className={styles.phoneStatusIcons}>
          <span className={styles.phoneSignal} aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span className={styles.phoneBattery} aria-hidden="true" />
        </span>
      </div>
      <div className={styles.phoneNotch} aria-hidden="true">
        <span />
        <i />
      </div>
      <div className={styles.phoneScreenViewport}>
        <div className={styles.phoneScreenContent} inert>
          <div className={phase === "unlocked" ? styles.unlockScreenReveal : undefined}>
            <AppPage className={styles.phoneAppPage}>
              <PageHeader
                className="mb-3"
                title={tVault("title")}
                description={tVault("accountsDescription")}
                action={
                  <Button
                    variant="outline"
                    size="icon"
                    type="button"
                    aria-label={tLogout("settings")}
                    title={tLogout("settings")}
                  >
                    <Settings aria-hidden="true" />
                  </Button>
                }
              />
              <SurfaceCard aria-label={tVault("accountsLabel")}>
                <PersonalVaultAccounts
                  vaultId={PERSONAL_VAULT_ID}
                  previewDensity="compact"
                  previewOnly
                  previewPassphraseValue={previewPassphraseValue}
                />
              </SurfaceCard>
            </AppPage>
          </div>
        </div>
      </div>
      {cursorTarget && phase !== "locked" && phase !== "unlocked" && (
        <div
          className={styles.unlockDemoCursor}
          style={{ transform: `translate3d(${cursorTarget.x}px, ${cursorTarget.y}px, 0)` }}
          aria-hidden="true"
        >
          <MousePointer2 />
        </div>
      )}
    </div>
  );
}

function createPreviewWorkspace(
  personalVaultName: string,
  accountInputs: Array<{ issuer: string; accountName: string; secret: Uint8Array }>,
): UnlockedVaultWorkspace {
  const vaultKey = new Uint8Array(32);
  const personalVault = {
    id: PERSONAL_VAULT_ID,
    name: personalVaultName,
    type: "PERSONAL" as const,
    role: "OWNER" as const,
    effectiveAccountPermissions: effectiveSharedVaultAccountPermissions("OWNER", ALL_ACCOUNT_PERMISSIONS, {
      canAddAccounts: null,
      canEditAccounts: null,
      canDeleteAccounts: null,
    }),
    keyVersion: 1,
    key: vaultKey,
  };
  const accounts: UnlockedVaultWorkspace["accounts"] = accountInputs.map((account, index) => ({
    id: `landing-preview-account-${index + 1}`,
    issuer: account.issuer,
    accountName: account.accountName,
    secret: account.secret,
    vaultId: personalVault.id,
    vaultName: personalVault.name,
    vaultType: "PERSONAL" as const,
    revision: 1,
    algorithm: "SHA-1" as const,
    digits: 6 as const,
    period: 30,
    tags: [],
  }));

  return {
    profileId: "landing-preview-profile",
    synchronizedAt: "2026-01-01T00:00:00.000Z",
    synchronizationToken: "landing-preview-synthetic",
    syncState: "CURRENT",
    userRootKey: new Uint8Array(32),
    vaults: [personalVault],
    accounts,
    unavailableAccounts: [],
    unavailableSharedVaults: 0,
    userEncryptionPublicKey: { kty: "RSA", e: "AQAB", n: "synthetic-preview-only" },
  };
}

function syntheticSecret(seed: number): Uint8Array {
  return Uint8Array.from({ length: 20 }, (_, index) => (seed + index * 13) % 256);
}
