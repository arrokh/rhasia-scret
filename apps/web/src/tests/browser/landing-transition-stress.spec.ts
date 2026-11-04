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
  const scene = page.locator("[data-landing-desktop-scene]:visible");
  await expect(scene).toHaveAttribute("data-input-ready", "true");
  await expect(page.locator("[data-landing-device-showcase]")).toHaveAttribute("data-ready", "true", {
    timeout: 15_000,
  });
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

for (const reducedMotion of ["reduce", "no-preference"] as const) {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    test(`restores the 3D phone from the footer at ${viewport.width}px with ${reducedMotion} motion`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion });
      await page.goto("/landing");
      const scene = page.locator("[data-landing-desktop-scene]:visible");
      const primary = page.locator("[data-landing-primary-phone]");
      const phone = primary.locator('iframe[data-device-kind="phone"]');
      await expect(scene).toHaveAttribute("data-input-ready", "true");
      for (const step of ["unlocked", "devices", "settled"]) {
        await page.keyboard.press("PageDown");
        await expect(scene).toHaveAttribute("data-scene-step", step, { timeout: 20_000 });
      }
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
      await expect(page.locator("main > footer")).toBeInViewport();
      for (const view of ["sharedReady", "sharedCreate", "scan"]) {
        await page.locator(`[data-landing-phone-view="${view}"]:visible`).evaluate((card) => {
          const bounds = card.getBoundingClientRect();
          const journey = card.closest("[data-landing-phone-story-journey]");
          const sectionTop = journey ? journey.getBoundingClientRect().top + scrollY : 0;
          const target =
            innerWidth <= 720
              ? bounds.top + scrollY - innerHeight * 0.57
              : bounds.top + scrollY + bounds.height / 2 - innerHeight / 2;
          window.scrollTo({ top: Math.max(sectionTop, target), behavior: "instant" });
        });
        await expect(phone.contentFrame().locator(`[data-landing-phone-screen-entry="${view}"]`)).toBeVisible();
        await expect(primary).toHaveCSS("visibility", "visible");
        await expect(primary).toHaveCSS("opacity", "1");
        await expect(primary.locator("canvas")).toBeVisible();
        await expect
          .poll(() =>
            primary.locator("[data-landing-phone-body-bounds]").evaluate((body) => {
              const bounds = body.getBoundingClientRect();
              const top = document.querySelector("[data-landing-header]")?.getBoundingClientRect().bottom ?? 0;
              return Math.min(bounds.bottom, innerHeight) - Math.max(bounds.top, top);
            }),
          )
          .toBeGreaterThanOrEqual(80);
      }
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      for (const step of ["devices", "unlocked"]) {
        await page.keyboard.press("PageUp");
        await expect(scene).toHaveAttribute("data-scene-step", step, { timeout: 20_000 });
        await expect(primary).toHaveCSS("visibility", "visible");
        await expect(primary.locator("canvas")).toBeVisible();
      }
    });
  }
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`keeps one canonical 3D renderer and viewport across states at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/landing");
    const scene = page.locator("[data-landing-desktop-scene]:visible");
    const primary = page.locator("[data-landing-primary-phone]");
    const renderer = primary.locator('[data-layout="scene"]');
    await expect(scene).toHaveAttribute("data-input-ready", "true");
    await expect(primary.locator("[data-landing-phone-body-bounds]")).toBeAttached();
    const canvas = await primary.locator("canvas").elementHandle();
    const screen = await primary.locator('iframe[data-device-kind="phone"]').elementHandle();
    if (!canvas || !screen) throw new Error("The canonical phone renderer is unavailable.");
    const model = await renderer.getAttribute("data-device-model");
    const intrinsicBounds = () =>
      primary.locator("[data-landing-phone-body-bounds]").evaluate((element) => ({
        width: element.style.width,
        height: element.style.height,
      }));
    const originalBounds = await intrinsicBounds();
    const transitions = [
      ["locked", null],
      ["unlocked", "PageDown"],
      ["devices", "PageDown"],
      ["settled", "PageDown"],
      ["devices", "PageUp"],
      ["unlocked", "PageUp"],
    ] as const;
    for (const [step, key] of transitions) {
      if (key) await page.keyboard.press(key);
      await expect(scene).toHaveAttribute("data-scene-step", step, { timeout: 20_000 });
      await expect.poll(() => renderer.evaluate((element) => element.clientHeight)).toBe(viewport.height);
      await expect(renderer).toHaveAttribute("data-device-model", model ?? "");
      expect(await primary.locator("canvas").evaluate((element, original) => element === original, canvas)).toBe(true);
      expect(
        await primary
          .locator('iframe[data-device-kind="phone"]')
          .evaluate((element, original) => element === original, screen),
      ).toBe(true);
      await expect.poll(intrinsicBounds).toEqual(originalBounds);
    }
  });
}

for (const width of [390, 1440]) {
  test(`keeps the showcase floor camera continuous during departure and return at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto("/landing");
    const scene = page.locator("[data-landing-desktop-scene]:visible");
    await expect(scene).toHaveAttribute("data-input-ready", "true");
    await expect(page.locator("[data-landing-device-showcase]")).toHaveAttribute("data-ready", "true", {
      timeout: 15_000,
    });
    for (const step of ["unlocked", "devices"]) {
      await page.keyboard.press("PageDown");
      await expect(scene).toHaveAttribute("data-scene-step", step, { timeout: 20_000 });
    }
    const { samples, segments } = await page.evaluate(async () => {
      const container = document.querySelector<HTMLElement>('[data-layout="showcase"]');
      const gl = container?.querySelector("canvas")?.getContext("webgl2");
      if (!container || !gl) throw new Error("The showcase WebGL renderer is unavailable.");
      const programs = new Map<WebGLProgram, boolean>();
      const originalUseProgram = WebGL2RenderingContext.prototype.useProgram;
      const originalWidth = container.style.width;
      const samples: { distance: number; sideAmount: number }[] = [];
      let capturing = false;
      let currentFloor = false;
      const originalDrawElements = WebGL2RenderingContext.prototype.drawElements;
      const originalDrawArrays = WebGL2RenderingContext.prototype.drawArrays;
      WebGL2RenderingContext.prototype.useProgram = function (program) {
        if (this === gl && program && !programs.has(program)) {
          const source = (gl.getAttachedShaders(program) ?? []).map((shader) => gl.getShaderSource(shader)).join("\n");
          programs.set(
            program,
            source.includes("#define SHADER_TYPE MeshBasicMaterial") &&
              source.includes("#define USE_MAP") &&
              source.includes("#define OPAQUE"),
          );
        }
        if (this === gl) currentFloor = program !== null && programs.get(program) === true;
        return originalUseProgram.call(this, program);
      };
      WebGL2RenderingContext.prototype.drawElements = function (mode, count, type, offset) {
        if (this === gl && capturing && currentFloor) samples.push(readCamera());
        return originalDrawElements.call(this, mode, count, type, offset);
      };
      WebGL2RenderingContext.prototype.drawArrays = function (mode, first, count) {
        if (this === gl && capturing && currentFloor) samples.push(readCamera());
        return originalDrawArrays.call(this, mode, first, count);
      };
      const readCamera = () => {
        for (const [program, floor] of programs) {
          if (!floor) continue;
          const location = gl.getUniformLocation(program, "modelViewMatrix");
          if (!location) continue;
          const matrix: unknown = gl.getUniform(program, location);
          if (!(matrix instanceof Float32Array)) continue;
          // Invert the static floor's view matrix; its only model transform is y=-0.17.
          const x = -(matrix[0] * matrix[12] + matrix[1] * matrix[13] + matrix[2] * matrix[14]);
          const y = -(matrix[4] * matrix[12] + matrix[5] * matrix[13] + matrix[6] * matrix[14]) - 0.17;
          const z = -(matrix[8] * matrix[12] + matrix[9] * matrix[13] + matrix[10] * matrix[14]);
          const topAngle = Math.atan2(16.5, 0.01);
          const sideAngle = innerWidth <= 900 ? Math.atan2(30, 15) : Math.atan2(18, 25);
          const angle = Math.acos(Math.min(1, Math.max(-1, matrix[5])));
          return { distance: Math.hypot(x, y, z), sideAmount: (topAngle - angle) / (topAngle - sideAngle) };
        }
        throw new Error("The static floor camera matrix is unavailable.");
      };
      const nextFrames = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      try {
        // Repaint the settled frame to identify the floor program before sampling departure.
        container.style.width = `${innerWidth - 1}px`;
        await nextFrames();
        container.style.width = originalWidth;
        await nextFrames();
        samples.push(readCamera());
        capturing = true;
        const segments: { start: number; initialDistance: number }[] = [];
        for (const key of ["PageDown", "PageUp"]) {
          segments.push({ start: samples.length, initialDistance: readCamera().distance });
          const transitionStarted = performance.now();
          window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
          await new Promise<void>((resolve, reject) => {
            const sample = (time: number) => {
              try {
                const target = key === "PageDown" ? "settled" : "devices";
                if (document.querySelector<HTMLElement>("[data-landing-desktop-scene]")?.dataset.sceneStep === target) {
                  return resolve();
                }
                if (time - transitionStarted > 10_000)
                  return reject(new Error(`The ${key} showcase transition did not complete.`));
                requestAnimationFrame(sample);
              } catch (error) {
                reject(error);
              }
            };
            requestAnimationFrame(sample);
          });
        }
        return { samples, segments };
      } finally {
        container.style.width = originalWidth;
        WebGL2RenderingContext.prototype.useProgram = originalUseProgram;
        WebGL2RenderingContext.prototype.drawElements = originalDrawElements;
        WebGL2RenderingContext.prototype.drawArrays = originalDrawArrays;
      }
    });
    // Recover transition progress from camera orientation, not wall-clock cadence.
    // Every actual draw must follow the same fitted-distance path, even on a slow GPU.
    const sideY = width <= 900 ? 30 : 18;
    const sideZ = width <= 900 ? 15 : 25;
    const fittedOffset = samples[0].distance - Math.hypot(sideY, sideZ);
    expect(fittedOffset).toBeGreaterThan(0);
    expect(segments).toHaveLength(2);
    for (const sample of samples) {
      const amount = sample.sideAmount;
      const baseDistance = Math.hypot(16.5 + (sideY - 16.5) * amount, 0.01 + (sideZ - 0.01) * amount);
      expect(Math.abs(sample.distance - (baseDistance + fittedOffset * amount))).toBeLessThan(0.05);
    }
    expect(samples.at(-1)?.distance).toBeCloseTo(samples[0].distance, 0);
    await expect(scene).toHaveAttribute("data-scene-step", "devices");
  });
}

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

  const scene = page.locator('[data-landing-desktop-scene="true"]:visible');
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
  const hero = scene.locator('[class*="heroOverlay"]');
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
  await scene.evaluate((element, expectedStep) => {
    element.removeAttribute("data-transition-settled-at");
    const observer = new MutationObserver(() => {
      if (element.getAttribute("data-scene-step") !== expectedStep || element.getAttribute("aria-busy") !== "false")
        return;
      element.setAttribute("data-transition-settled-at", String(performance.now()));
      observer.disconnect();
    });
    observer.observe(element, { attributes: true, attributeFilter: ["data-scene-step", "aria-busy"] });
  }, to);
  const startedAt = shouldReverseDuringProcessing
    ? await sendActionAndRapidReversalBurst(page, scene, action)
    : await sendActionAndRecordStart(page, scene, action);

  await expect(scene).toHaveAttribute("data-scene-step", to, { timeout: budgetMs });
  await expect(scene).toHaveAttribute("aria-busy", "false", { timeout: budgetMs });
  const settledAt = Number(await scene.getAttribute("data-transition-settled-at"));
  expect(settledAt).toBeGreaterThanOrEqual(startedAt);
  const elapsedMs = settledAt - startedAt;
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
  await scene.evaluate(
    (element, eventType) => {
      window.addEventListener(
        eventType,
        () => element.setAttribute("data-transition-started-at", String(performance.now())),
        { once: true, capture: true },
      );
    },
    action.kind === "key" ? "keydown" : "wheel",
  );
  if (action.kind === "key") {
    await page.keyboard.press(action.key);
  } else {
    await page.mouse.wheel(0, action.deltaY);
  }
  return Number(await scene.getAttribute("data-transition-started-at"));
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
