import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLandingProgressTransitionDriver,
  createLandingShowcaseProgressApplier,
  getLandingShowcaseCameraDistance,
  LANDING_FLOOR_APPEARANCE,
} from "@/modules/landing/presentation/landing-phone-mockup";
import { landingFlowConfig } from "@/modules/landing/presentation/landing-flow.config";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/modules/landing/presentation/landing-vaults-home-preview", () => ({
  LandingVaultsHomePreview: () => null,
}));

type FrameQueue = Readonly<{
  callbacks: Map<number, FrameRequestCallback>;
  driver: ReturnType<typeof createLandingProgressTransitionDriver>;
  advanceTo: (time: number) => void;
}>;

function createFrameQueue(initialProgress = 0): FrameQueue {
  let nextFrame = 1;
  let now = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const driver = createLandingProgressTransitionDriver(initialProgress, {
    now: () => now,
    requestFrame: (callback) => {
      const frame = nextFrame++;
      callbacks.set(frame, callback);
      return frame;
    },
    cancelFrame: (frame) => callbacks.delete(frame),
  });
  return {
    callbacks,
    driver,
    advanceTo(time) {
      now = time;
      const pendingCallbacks = [...callbacks.values()];
      callbacks.clear();
      pendingCallbacks.forEach((callback) => callback(time));
    },
  };
}

function requestProgress(
  driver: ReturnType<typeof createLandingProgressTransitionDriver>,
  progress: number,
  options: Readonly<{
    available?: boolean;
    snap?: boolean;
    duration?: number;
    applyProgress?: (nextProgress: number) => void;
    onComplete?: () => void;
  }> = {},
) {
  driver.setTarget({
    progress,
    duration: options.duration ?? 850,
    available: options.available ?? true,
    snap: options.snap ?? false,
    applyProgress: options.applyProgress ?? vi.fn(),
    onComplete: options.onComplete ?? vi.fn(),
  });
}

afterEach(() => vi.restoreAllMocks());

const sideCameraDirectionLength = Math.hypot(30, 15);
const sideCameraFrame = {
  cameraRight: { x: 1, y: 0, z: 0 },
  cameraUp: { x: 0, y: 15 / sideCameraDirectionLength, z: -30 / sideCameraDirectionLength },
  cameraPositionDirection: { x: 0, y: 30 / sideCameraDirectionLength, z: 15 / sideCameraDirectionLength },
};
const compactShowcaseDevicePoints = landingFlowConfig.showcase.devices.flatMap((device) => {
  const dimensions =
    device.kind === "tablet" ? { width: 9.55, height: 0.2, depth: 7.16 } : { width: 9.6, height: 6.55, depth: 6.55 };
  const horizontalHalfExtent =
    ((Math.abs(Math.cos(device.yaw)) * dimensions.width + Math.abs(Math.sin(device.yaw)) * dimensions.depth) *
      device.scale) /
    2;
  const depthHalfExtent =
    ((Math.abs(Math.sin(device.yaw)) * dimensions.width + Math.abs(Math.cos(device.yaw)) * dimensions.depth) *
      device.scale) /
    2;
  const xCenter = device.x * 0.62;
  const zCenter = device.z * 4;
  const yBottom = -0.17;
  const yTop = yBottom + dimensions.height * device.scale;
  return [-1, 1].flatMap((horizontalSide) =>
    [-1, 1].flatMap((verticalSide) =>
      [-1, 1].map((depthSide) => ({
        x: xCenter + horizontalSide * horizontalHalfExtent,
        y: verticalSide < 0 ? yBottom : yTop,
        z: zCenter + depthSide * depthHalfExtent,
      })),
    ),
  );
});

describe("LandingStoryEnvironment floor appearance", () => {
  it("keeps the shared floor color and grid unlit across top-down and side-camera scenes", () => {
    expect(LANDING_FLOOR_APPEARANCE).toEqual({ color: 0xf8f4ed, gridStrength: 1, toneMapped: false });
  });
});

describe("LandingDeviceShowcase responsive layout replay", () => {
  it("reapplies the latest progress on resize only after the layout is initialized", () => {
    const applyProgress = vi.fn();
    const layout = createLandingShowcaseProgressApplier(applyProgress);

    expect(layout.reapply()).toBe(false);
    expect(applyProgress).not.toHaveBeenCalled();

    layout.setProgress(0.72);
    expect(layout.reapply()).toBe(true);
    layout.setProgress(0.38);
    expect(layout.reapply()).toBe(true);

    expect(applyProgress.mock.calls).toEqual([[0.72], [0.72], [0.38], [0.38]]);
  });
});

describe("LandingDeviceShowcase responsive camera framing", () => {
  it("fits the compact showcase device bounds inside mobile and tablet camera frames", () => {
    const viewports = [
      { width: 390, height: 844 },
      { width: 320, height: 568 },
      { width: 768, height: 1024 },
    ];
    const frameOccupancy = 0.84;
    const verticalFovDegrees = 40;
    const distances = viewports.map(({ width, height }) => {
      const distance = getLandingShowcaseCameraDistance({
        points: compactShowcaseDevicePoints,
        viewportWidth: width,
        viewportHeight: height,
        verticalFovDegrees,
        ...sideCameraFrame,
      });
      const verticalTangent = Math.tan((verticalFovDegrees * Math.PI) / 360);
      const horizontalTangent = verticalTangent * (width / height);

      for (const point of compactShowcaseDevicePoints) {
        const depthOffset =
          point.x * sideCameraFrame.cameraPositionDirection.x +
          point.y * sideCameraFrame.cameraPositionDirection.y +
          point.z * sideCameraFrame.cameraPositionDirection.z;
        const depth = distance - depthOffset;
        const horizontalOffset = point.x * sideCameraFrame.cameraRight.x + point.y * sideCameraFrame.cameraRight.y;
        const verticalOffset =
          point.x * sideCameraFrame.cameraUp.x +
          point.y * sideCameraFrame.cameraUp.y +
          point.z * sideCameraFrame.cameraUp.z;

        expect(depth).toBeGreaterThan(0);
        expect(Math.abs(horizontalOffset)).toBeLessThanOrEqual(depth * horizontalTangent * frameOccupancy + 1e-8);
        expect(Math.abs(verticalOffset)).toBeLessThanOrEqual(depth * verticalTangent * frameOccupancy + 1e-8);
      }
      return distance;
    });

    expect(distances.every((distance) => distance > 0 && distance < 140)).toBe(true);
  });
});

describe("LandingDeviceShowcase progress transitions", () => {
  it("reverses rapid targets from the current rendered progress and completes only the latest target", () => {
    const queue = createFrameQueue();
    const complete = vi.fn();
    const applyProgress = vi.fn();

    for (const [index, progress] of [1, 0, 0.8, 0.2, 0.5].entries()) {
      const current = queue.driver.getCurrentProgress();
      requestProgress(queue.driver, progress, { applyProgress, onComplete: complete });
      expect(queue.driver.getCurrentProgress()).toBe(current);
      queue.advanceTo((index + 1) * 90);
    }

    expect(complete).not.toHaveBeenCalled();
    queue.advanceTo(5 * 90 + 850);

    expect(queue.driver.getCurrentProgress()).toBe(0.5);
    expect(queue.driver.getTargetProgress()).toBe(0.5);
    expect(complete).toHaveBeenCalledOnce();
    expect(applyProgress).toHaveBeenLastCalledWith(0.5);
    expect(queue.callbacks.size).toBe(0);
  });

  it("uses one smooth quintic curve from the first expansion frame", () => {
    const queue = createFrameQueue();
    requestProgress(queue.driver, 0.5, { duration: 1000 });

    queue.advanceTo(250);

    expect(queue.driver.getCurrentProgress()).toBeCloseTo(0.0517578125);
  });

  it("completes exactly once when a reversal target equals the current rendered progress", () => {
    const queue = createFrameQueue();
    const complete = vi.fn();
    requestProgress(queue.driver, 1, { onComplete: complete });
    queue.advanceTo(250);

    const renderedProgress = queue.driver.getCurrentProgress();
    expect(renderedProgress).toBeGreaterThan(0);
    expect(renderedProgress).toBeLessThan(1);

    requestProgress(queue.driver, renderedProgress, { onComplete: complete });
    expect(queue.driver.getCurrentProgress()).toBe(renderedProgress);
    expect(queue.driver.getTargetProgress()).toBe(renderedProgress);
    expect(queue.callbacks.size).toBe(0);
    expect(complete).toHaveBeenCalledOnce();

    requestProgress(queue.driver, renderedProgress, { onComplete: complete });
    expect(complete).toHaveBeenCalledOnce();
  });

  it("retains the newest target until the renderer becomes ready", () => {
    const queue = createFrameQueue();
    const complete = vi.fn();
    const applyProgress = vi.fn();

    requestProgress(queue.driver, 0.5, { available: false, onComplete: complete, applyProgress });
    requestProgress(queue.driver, 0.25, { available: false, onComplete: complete, applyProgress });

    expect(queue.driver.getCurrentProgress()).toBe(0);
    expect(queue.driver.getTargetProgress()).toBe(0.25);
    expect(queue.callbacks.size).toBe(0);
    expect(complete).not.toHaveBeenCalled();

    requestProgress(queue.driver, 0.25, { onComplete: complete, applyProgress });
    queue.advanceTo(850);

    expect(queue.driver.getCurrentProgress()).toBe(0.25);
    expect(complete).toHaveBeenCalledOnce();
    expect(applyProgress).toHaveBeenLastCalledWith(0.25);
  });

  it("cancels and completes an active transition when the renderer fails", () => {
    const queue = createFrameQueue();
    const complete = vi.fn();
    const applyProgress = vi.fn();
    requestProgress(queue.driver, 0.5, { onComplete: complete, applyProgress });
    queue.advanceTo(250);
    expect(queue.callbacks.size).toBe(1);

    requestProgress(queue.driver, 0.5, {
      available: false,
      snap: true,
      onComplete: complete,
      applyProgress,
    });

    expect(queue.driver.getCurrentProgress()).toBe(0.5);
    expect(complete).toHaveBeenCalledOnce();
    expect(applyProgress).toHaveBeenLastCalledWith(0.5);
    expect(queue.callbacks.size).toBe(0);
  });

  it("can cancel and resume pending RAF work across a StrictMode effect replay", () => {
    const queue = createFrameQueue();
    const complete = vi.fn();
    requestProgress(queue.driver, 0.5, { onComplete: complete });
    expect(queue.callbacks.size).toBe(1);

    queue.driver.cancelAnimation();
    expect(queue.callbacks.size).toBe(0);
    expect(queue.driver.getTargetProgress()).toBe(0.5);

    requestProgress(queue.driver, 0.5, { onComplete: complete });
    queue.advanceTo(850);

    expect(queue.driver.getCurrentProgress()).toBe(0.5);
    expect(complete).toHaveBeenCalledOnce();
    expect(queue.callbacks.size).toBe(0);
  });
});
