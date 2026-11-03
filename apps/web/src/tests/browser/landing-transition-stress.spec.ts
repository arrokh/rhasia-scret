import { expect, test, type Locator, type Page } from "@playwright/test";
import { landingFlowConfig } from "../../modules/landing/presentation/landing-flow.config";

type StableSceneStep = "locked" | "unlocked" | "devices";
type InputAction =
  | Readonly<{ kind: "key"; key: "ArrowDown" | "ArrowUp" | "PageDown" | "PageUp" }>
  | Readonly<{ kind: "wheel"; deltaY: number }>;
type LandingTransitionStressInputRecord = Readonly<{
  startedAt: number;
  initialIsTrusted: boolean;
  initialDefaultPrevented: boolean;
  reversalDefaultPrevented: readonly boolean[];
}>;
type LandingTransitionWindow = Window & {
  __landingTransitionStressSteps?: StableSceneStep[];
  __landingTransitionStressObserver?: MutationObserver;
  __landingTransitionStressInput?: LandingTransitionStressInputRecord;
};

test("recovers through repeated landing steps after deterministic wheel and key reversals", async ({ page }) => {
  await runLandingTransitionStress(page, "no-preference", true);
});

test("recovers through repeated landing steps with reduced motion", async ({ page }) => {
  await runLandingTransitionStress(page, "reduce", false);
});

test("keeps the mobile phone continuous through departure and return", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/landing");
  const scene = page.locator("[data-landing-desktop-scene]");
  await expect(scene).toHaveAttribute("data-input-ready", "true");
  await expect(page.locator("[data-landing-device-showcase]")).toHaveAttribute("data-ready", "true");
  await page.keyboard.press("PageDown");
  await expect(scene).toHaveAttribute("data-scene-step", "unlocked");
  await page.keyboard.press("PageDown");
  await expect(scene).toHaveAttribute("data-scene-step", "devices");

  for (const direction of ["forward", "reverse"] as const) {
    const samples = await page.evaluate(async (direction) => {
      const scene = document.querySelector<HTMLElement>("[data-landing-desktop-scene]");
      const phone = document.querySelector<HTMLIFrameElement>(
        '[data-landing-primary-phone] iframe[data-device-kind="phone"]',
      );
      if (!scene || !phone) throw new Error("The landing phone is unavailable.");
      const target = direction === "forward" ? "settled" : "devices";
      const samples: { time: number; top: number; bottom: number; height: number; step: string }[] = [];
      const deadline = performance.now() + 5_000;
      let settledFrames = 0;
      return new Promise<typeof samples>((resolve, reject) => {
        const sample = (time: number) => {
          const bounds = phone.getBoundingClientRect();
          const step = scene.dataset.sceneStep ?? "";
          samples.push({ time, top: bounds.top, bottom: bounds.bottom, height: bounds.height, step });
          settledFrames = step === target ? settledFrames + 1 : 0;
          if (settledFrames >= 8) return resolve(samples);
          if (time > deadline) return reject(new Error(`The mobile ${direction} handoff did not settle.`));
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: direction === "forward" ? "PageDown" : "PageUp",
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    }, direction);
    expect(samples.some(({ step }) => step === (direction === "forward" ? "leaving" : "returning"))).toBe(true);
    for (const [index, sample] of samples.entries()) {
      expect(sample.top).toBeGreaterThanOrEqual(-12);
      expect(sample.bottom).toBeLessThanOrEqual(856);
      if (index === 0) continue;
      const previous = samples[index - 1];
      const budget = Math.max(12, (sample.time - previous.time) * 1.2);
      expect(Math.abs(sample.top - previous.top)).toBeLessThanOrEqual(budget);
      expect(Math.abs(sample.height - previous.height)).toBeLessThanOrEqual(budget);
    }
  }
  await page.keyboard.press("PageDown");
  await expect(scene).toHaveAttribute("data-scene-step", "leaving");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedStyles = await page.locator("[data-landing-primary-phone]").evaluate((phone) => ({
    step: document.querySelector<HTMLElement>("[data-landing-desktop-scene]")?.dataset.sceneStep,
    rootProperty: getComputedStyle(phone).transitionProperty,
    innerProperty: getComputedStyle(phone.querySelector<HTMLElement>('[data-layout="scene"]')!).transitionProperty,
  }));
  expect(reducedStyles.step).toBe("leaving");
  expect(reducedStyles.rootProperty).toBe("none");
  expect(reducedStyles.innerProperty).toBe("none");
});

async function runLandingTransitionStress(
  page: Page,
  reducedMotion: "reduce" | "no-preference",
  reverseDuringProcessing: boolean,
) {
  const { durationsMs, input, unlockDemo } = landingFlowConfig.intro;
  const schedulingAllowanceMs = 5_000;
  const unlockBudgetMs =
    unlockDemo.startDelay +
    unlockDemo.cursorTravel * 2 +
    unlockDemo.characterInterval * unlockDemo.maskedPassphraseLength +
    unlockDemo.preUnlockPause +
    unlockDemo.buttonPress +
    schedulingAllowanceMs;
  const expansionBudgetMs = durationsMs.showcaseExpansion + schedulingAllowanceMs;
  const contractionBudgetMs = durationsMs.showcaseExpansion * 2 + 100 + schedulingAllowanceMs;
  const quietPeriodMs = input.wheelGestureReleaseMs + 100;

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion });
  await page.goto("/landing");

  const scene = page.locator('[data-landing-desktop-scene="true"]');
  await expect(scene).toHaveAttribute("data-scene-step", "locked");
  await expect(scene).toHaveAttribute("data-input-ready", "true");
  await expect(scene).toHaveAttribute("aria-busy", "false");
  await expect(page.locator('[data-landing-device-showcase="true"]')).toHaveAttribute("data-ready", "true", {
    timeout: 15_000,
  });
  const phonePreview = page
    .locator("[data-landing-primary-phone]")
    .getByRole("img")
    .locator('iframe[data-device-kind="phone"]')
    .first()
    .contentFrame();
  await expect(phonePreview.locator("[data-unlock-phase]")).toHaveAttribute("data-unlock-phase", "locked", {
    timeout: 15_000,
  });
  await page.mouse.move(8, 8);
  await startSettledStepRecording(page);

  const expectedSettledSteps: StableSceneStep[] = ["locked"];
  const roundTrip: ReadonlyArray<Readonly<{ from: StableSceneStep; to: StableSceneStep; action: InputAction }>> = [
    { from: "locked", to: "unlocked", action: { kind: "key", key: "ArrowDown" } },
    { from: "unlocked", to: "devices", action: { kind: "wheel", deltaY: 640 } },
    { from: "devices", to: "unlocked", action: { kind: "key", key: "PageUp" } },
    { from: "unlocked", to: "locked", action: { kind: "key", key: "ArrowUp" } },
    { from: "locked", to: "unlocked", action: { kind: "wheel", deltaY: 640 } },
    { from: "unlocked", to: "devices", action: { kind: "key", key: "PageDown" } },
  ];

  for (let cycle = 0; cycle < 2; cycle += 1) {
    if (cycle > 0) {
      await settleTransition(
        page,
        scene,
        "devices",
        "unlocked",
        { kind: "key", key: "ArrowUp" },
        {
          reducedMotion,
          reverseDuringProcessing,
          unlockBudgetMs,
          expansionBudgetMs,
          contractionBudgetMs,
          quietPeriodMs,
        },
      );
      expectedSettledSteps.push("unlocked");
      await settleTransition(
        page,
        scene,
        "unlocked",
        "locked",
        { kind: "key", key: "PageUp" },
        {
          reducedMotion,
          reverseDuringProcessing,
          unlockBudgetMs,
          expansionBudgetMs,
          contractionBudgetMs,
          quietPeriodMs,
        },
      );
      expectedSettledSteps.push("locked");
    }

    for (const transition of roundTrip) {
      await settleTransition(page, scene, transition.from, transition.to, transition.action, {
        reducedMotion,
        reverseDuringProcessing,
        unlockBudgetMs,
        expansionBudgetMs,
        contractionBudgetMs,
        quietPeriodMs,
      });
      expectedSettledSteps.push(transition.to);
    }
  }

  await expect(scene).toHaveAttribute("data-scene-step", "devices");
  await expect(scene).toHaveAttribute("aria-busy", "false");
  await expect(page).toHaveURL(/\/landing$/);
  const hero = scene.locator('[class*="__heroOverlay"]');
  await expect(hero).not.toHaveAttribute("inert", "");
  const localVaultLink = hero.locator('a[href="/local?from=landing"]');
  await expect(localVaultLink).toBeVisible();
  await expect(localVaultLink).toBeEnabled();
  await localVaultLink.focus();
  await expect(localVaultLink).toBeFocused();

  const observedSettledSteps = await stopSettledStepRecording(page);
  expect(observedSettledSteps).toEqual(expectedSettledSteps);
}

async function settleTransition(
  page: Page,
  scene: Locator,
  from: StableSceneStep,
  to: StableSceneStep,
  action: InputAction,
  options: Readonly<{
    reducedMotion: "reduce" | "no-preference";
    reverseDuringProcessing: boolean;
    unlockBudgetMs: number;
    expansionBudgetMs: number;
    contractionBudgetMs: number;
    quietPeriodMs: number;
  }>,
) {
  await expect(scene).toHaveAttribute("data-input-ready", "true");
  await expect(scene).toHaveAttribute("data-scene-step", from);
  await expect(scene).toHaveAttribute("aria-busy", "false");

  const budgetMs = getTransitionBudget(from, to, options);
  const shouldReverseDuringProcessing =
    options.reverseDuringProcessing && options.reducedMotion === "no-preference" && to !== "locked";
  const startedAt = shouldReverseDuringProcessing
    ? await sendActionAndRapidReversalBurst(page, scene, action)
    : await sendActionAndRecordStart(page, scene, action);

  await expect(scene).toHaveAttribute("data-scene-step", to, { timeout: budgetMs });
  await expect(scene).toHaveAttribute("aria-busy", "false", { timeout: budgetMs });
  const elapsedMs = await page.evaluate((start) => performance.now() - start, startedAt);
  expect(
    elapsedMs,
    `${from} → ${to} should settle within its ${budgetMs}ms configured-duration budget (elapsed ${Math.round(elapsedMs)}ms)`,
  ).toBeLessThanOrEqual(budgetMs);

  await page.evaluate(
    (durationMs) => new Promise<void>((resolve) => window.setTimeout(resolve, durationMs)),
    options.quietPeriodMs,
  );
  await expect(scene).toHaveAttribute("data-scene-step", to);
  await expect(scene).toHaveAttribute("aria-busy", "false");
}

function getTransitionBudget(
  from: StableSceneStep,
  to: StableSceneStep,
  options: Readonly<{
    unlockBudgetMs: number;
    expansionBudgetMs: number;
    contractionBudgetMs: number;
  }>,
) {
  if (from === "locked" && to === "unlocked") return options.unlockBudgetMs;
  if (from === "unlocked" && to === "devices") return options.expansionBudgetMs;
  if (from === "devices" && to === "unlocked") return options.contractionBudgetMs;
  return 500;
}

async function sendActionAndRecordStart(page: Page, scene: Locator, action: InputAction) {
  await expect(scene).toHaveAttribute("data-input-ready", "true");
  if (action.kind === "key") {
    await page.keyboard.press(action.key);
  } else {
    await page.mouse.wheel(0, action.deltaY);
  }
  return page.evaluate(() => performance.now());
}

async function sendActionAndRapidReversalBurst(page: Page, scene: Locator, action: InputAction) {
  await expect(scene).toHaveAttribute("data-input-ready", "true");
  await page.evaluate((action) => {
    const trackedWindow = window as LandingTransitionWindow;
    const activeScene = document.querySelector<HTMLElement>('[data-landing-desktop-scene="true"]');
    if (!activeScene || activeScene.getAttribute("data-input-ready") !== "true") {
      throw new Error("Landing input listeners are not ready for the transition stress test.");
    }
    const eventType = action.kind === "key" ? "keydown" : "wheel";
    const listener: EventListener = (event) => {
      const startedAt = performance.now();
      const reversalEvents = [
        new WheelEvent("wheel", { deltaY: -640, bubbles: true, cancelable: true }),
        new WheelEvent("wheel", { deltaY: 640, bubbles: true, cancelable: true }),
        new KeyboardEvent("keydown", { key: "PageDown", bubbles: true, cancelable: true }),
        new WheelEvent("wheel", { deltaY: -640, bubbles: true, cancelable: true }),
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }),
      ];
      const reversalDefaultPrevented = reversalEvents.map((reversalEvent) => {
        window.dispatchEvent(reversalEvent);
        return reversalEvent.defaultPrevented;
      });
      trackedWindow.__landingTransitionStressInput = {
        startedAt,
        initialIsTrusted: event.isTrusted,
        initialDefaultPrevented: event.defaultPrevented,
        reversalDefaultPrevented,
      };
    };
    delete trackedWindow.__landingTransitionStressInput;
    window.addEventListener(eventType, listener, { once: true });
  }, action);

  if (action.kind === "key") {
    await page.keyboard.press(action.key);
  } else {
    await page.mouse.wheel(0, action.deltaY);
  }

  const input = await page.evaluate(() => (window as LandingTransitionWindow).__landingTransitionStressInput ?? null);
  if (!input) throw new Error("The trusted landing input did not trigger the reversal burst.");
  expect(input.initialIsTrusted).toBe(true);
  expect(input.initialDefaultPrevented).toBe(true);
  expect(input.reversalDefaultPrevented).toEqual([true, true, true, true, true]);
  return input.startedAt;
}

async function startSettledStepRecording(page: Page) {
  await page.evaluate(() => {
    const scene = document.querySelector<HTMLElement>('[data-landing-desktop-scene="true"]');
    if (!scene) throw new Error("The landing scene is unavailable for stress tracking.");
    const trackedWindow = window as LandingTransitionWindow;
    const steps: StableSceneStep[] = [];
    const recordCurrentStep = () => {
      if (scene.getAttribute("aria-busy") !== "false") return;
      const step = scene.dataset.sceneStep;
      if (step !== "locked" && step !== "unlocked" && step !== "devices") return;
      if (steps[steps.length - 1] !== step) steps.push(step);
    };
    trackedWindow.__landingTransitionStressSteps = steps;
    trackedWindow.__landingTransitionStressObserver = new MutationObserver(recordCurrentStep);
    trackedWindow.__landingTransitionStressObserver.observe(scene, {
      attributes: true,
      attributeFilter: ["aria-busy", "data-scene-step"],
    });
    recordCurrentStep();
  });
}

async function stopSettledStepRecording(page: Page) {
  return page.evaluate(() => {
    const trackedWindow = window as LandingTransitionWindow;
    trackedWindow.__landingTransitionStressObserver?.disconnect();
    return trackedWindow.__landingTransitionStressSteps ?? [];
  });
}
