"use client";

import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import type * as ThreeTypes from "three";
import { useTranslations } from "next-intl";
import { LandingVaultsHomePreview } from "./landing-vaults-home-preview";
import {
  landingFlowConfig,
  type LandingDeviceKind,
  type LandingPhoneView,
  type LandingShowcaseDevice,
} from "./landing-flow.config";
import styles from "./landing-desktop-scene.module.css";

const LandingHostedVaultScreen = dynamic(
  () => import("./landing-hosted-vault-screen").then((module) => module.LandingHostedVaultScreen),
  { ssr: false },
);

export type { LandingDeviceKind, LandingPhoneView } from "./landing-flow.config";

type LandingPhoneMockupProps = {
  view: LandingPhoneView;
  layout: "story" | "scene";
  /** The parent phase signal invalidates layers; StoryEnvironment owns the shared CSS background. */
  transparentFloor?: boolean;
  startUnlockDemo?: boolean;
  unlockDemoResetToken?: number;
  onUnlockComplete?: () => void;
};

type ThreeRuntime = typeof import("three");
type Css3dRuntime = typeof import("three/addons/renderers/CSS3DRenderer.js");
type GltfLoaderRuntime = typeof import("three/addons/loaders/GLTFLoader.js");
type MeshoptDecoderRuntime = typeof import("three/addons/libs/meshopt_decoder.module.js");

type LandingModelKey = "iphone" | "macbook";

const LANDING_PHONE_MODEL_ID = landingFlowConfig.showcase.phoneModelId;
const LANDING_FLOOR_LEVEL = -0.17;
const PHONE_SCREEN_STYLESHEET_WARMUP_MS = 320;

const landingModelPaths: Readonly<Record<LandingModelKey, string>> = landingFlowConfig.showcase.modelPaths;

const landingModelSources = new Map<LandingModelKey, Promise<ThreeTypes.Group>>();

function loadLandingModel(
  key: LandingModelKey,
  three: ThreeRuntime,
  { GLTFLoader }: GltfLoaderRuntime,
  { MeshoptDecoder }: MeshoptDecoderRuntime,
): Promise<ThreeTypes.Group> {
  const existing = landingModelSources.get(key);
  if (existing) return existing;

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const pending = MeshoptDecoder.ready
    .then(() => loader.loadAsync(landingModelPaths[key]))
    .then((gltf) => {
      if (key === "iphone") styleIphoneAsGraphite(gltf.scene, three);
      if (key === "macbook") styleMacBookAsGraphite(gltf.scene, three);
      return gltf.scene;
    })
    .catch((error: unknown) => {
      landingModelSources.delete(key);
      throw error;
    });
  landingModelSources.set(key, pending);
  return pending;
}

function createLandingStudioEnvironment(three: ThreeRuntime) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const lightFalloff = context.createLinearGradient(0, 0, 0, canvas.height);
  lightFalloff.addColorStop(0, "#ffffff");
  lightFalloff.addColorStop(0.28, "#cbd2d7");
  lightFalloff.addColorStop(0.5, "#71787d");
  lightFalloff.addColorStop(0.68, "#f6f1e8");
  lightFalloff.addColorStop(1, "#ffffff");
  context.fillStyle = lightFalloff;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgb(255 255 255 / 88%)";
  context.fillRect(6, 4, 7, 12);
  context.fillRect(26, 2, 14, 3);
  context.fillRect(50, 5, 6, 13);

  const environment = new three.CanvasTexture(canvas);
  environment.mapping = three.EquirectangularReflectionMapping;
  environment.colorSpace = three.SRGBColorSpace;
  return environment;
}

function styleIphoneAsGraphite(model: ThreeTypes.Group, three: ThreeRuntime) {
  const replacements = new Map<ThreeTypes.Material, ThreeTypes.Material>();
  const graphite = new three.Color(0x3f474d);
  const blackTitanium = new three.Color(0x15191c);
  model.traverse((object) => {
    if (object.type !== "Mesh") return;
    const mesh = object as ThreeTypes.Mesh;
    const style = (material: ThreeTypes.Material) => {
      if (/screen|glass|lensinglass|black/i.test(material.name)) return material;
      const existing = replacements.get(material);
      if (existing) return existing;
      const next = material.clone();
      if ("color" in next && "emissive" in next) {
        const standard = next as ThreeTypes.MeshStandardMaterial;
        if (/metalframe/i.test(material.name)) {
          standard.color.copy(graphite);
          standard.emissive.set(0x000000);
          standard.metalness = 0.82;
          standard.roughness = 0.23;
        }
        if (/basecolor|material\.005|backpanel/i.test(material.name)) {
          standard.color.copy(blackTitanium);
          standard.emissive.set(0x000000);
          standard.metalness = 0.56;
          standard.roughness = 0.3;
        }
      }
      replacements.set(material, next);
      return next;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(style) : style(mesh.material);
  });
}

function styleMacBookAsGraphite(model: ThreeTypes.Group, three: ThreeRuntime) {
  const replacements = new Map<ThreeTypes.Material, ThreeTypes.Material>();
  const graphite = new three.Color(0x333a40);
  model.traverse((object) => {
    if (object.type !== "Mesh") return;
    const mesh = object as ThreeTypes.Mesh;
    const style = (material: ThreeTypes.Material) => {
      const existing = replacements.get(material);
      if (existing) return existing;
      const next = material.clone();
      if ("color" in next && "emissive" in next) {
        const standard = next as ThreeTypes.MeshStandardMaterial;
        const color = standard.color;
        const channels = [color.r, color.g, color.b];
        const neutral = Math.max(...channels) - Math.min(...channels) < 0.14;
        const luminance = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
        const emissiveStrength = standard.emissive.r + standard.emissive.g + standard.emissive.b;
        if (emissiveStrength < 0.06 && neutral && luminance > 0.16) {
          color.copy(graphite);
          standard.metalness = Math.max(standard.metalness, 0.38);
          standard.roughness = Math.min(Math.max(standard.roughness, 0.23), 0.4);
        }
      }
      replacements.set(material, next);
      return next;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(style) : style(mesh.material);
  });
}

type DeviceScreenDimensions = Readonly<{
  kind: LandingDeviceKind;
  viewportWidth: number;
  viewportHeight: number;
}>;

const showcaseDevices: readonly LandingShowcaseDevice[] = landingFlowConfig.showcase.devices;

type ScreenPortal = Readonly<{ device: LandingShowcaseDevice; host: HTMLElement }>;
type DeviceShowcaseController = Readonly<{
  setProgress: (nextProgress: number) => void;
  cleanup: () => void;
}>;

type PhoneSceneController = Readonly<{
  render: () => void;
  cleanup: () => void;
}>;

type LandingDeviceShowcaseProps = Readonly<{
  progress: number;
  transitionDuration?: number;
  onReady?: () => void;
  onTransitionComplete?: () => void;
}>;

type LandingProgressTransitionRequest = Readonly<{
  progress: number;
  duration: number;
  available: boolean;
  snap: boolean;
  applyProgress: (progress: number) => void;
  onComplete: () => void;
}>;

type LandingProgressTransitionScheduler = Readonly<{
  now: () => number;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (frame: number) => void;
}>;

type LandingCameraFitVector = Readonly<{ x: number; y: number; z: number }>;

type LandingShowcaseCameraFitInput = Readonly<{
  points: readonly LandingCameraFitVector[];
  viewportWidth: number;
  viewportHeight: number;
  verticalFovDegrees: number;
  cameraRight: LandingCameraFitVector;
  cameraUp: LandingCameraFitVector;
  cameraPositionDirection: LandingCameraFitVector;
  frameOccupancy?: number;
}>;

export function getLandingShowcaseCameraDistance({
  points,
  viewportWidth,
  viewportHeight,
  verticalFovDegrees,
  cameraRight,
  cameraUp,
  cameraPositionDirection,
  frameOccupancy = 0.84,
}: LandingShowcaseCameraFitInput) {
  if (
    points.length === 0 ||
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    verticalFovDegrees <= 0 ||
    verticalFovDegrees >= 180 ||
    frameOccupancy <= 0 ||
    frameOccupancy > 1
  ) {
    return 0;
  }

  const verticalTangent = Math.tan((verticalFovDegrees * Math.PI) / 360);
  const horizontalTangent = verticalTangent * (viewportWidth / viewportHeight);
  if (verticalTangent <= 0 || horizontalTangent <= 0) return 0;

  let requiredDistance = 0;
  for (const point of points) {
    const depthOffset =
      point.x * cameraPositionDirection.x + point.y * cameraPositionDirection.y + point.z * cameraPositionDirection.z;
    const horizontalOffset = point.x * cameraRight.x + point.y * cameraRight.y + point.z * cameraRight.z;
    const verticalOffset = point.x * cameraUp.x + point.y * cameraUp.y + point.z * cameraUp.z;
    requiredDistance = Math.max(
      requiredDistance,
      depthOffset + Math.abs(horizontalOffset) / (horizontalTangent * frameOccupancy),
      depthOffset + Math.abs(verticalOffset) / (verticalTangent * frameOccupancy),
    );
  }
  return Math.max(0, requiredDistance);
}

const browserLandingProgressTransitionScheduler: LandingProgressTransitionScheduler = {
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (frame) => cancelAnimationFrame(frame),
};

export function createLandingShowcaseProgressApplier(applyProgress: (progress: number) => void) {
  let currentProgress: number | null = null;

  return {
    setProgress(progress: number) {
      currentProgress = progress;
      applyProgress(progress);
    },
    reapply() {
      if (currentProgress === null) return false;
      applyProgress(currentProgress);
      return true;
    },
  };
}

export function createLandingProgressTransitionDriver(
  initialProgress: number,
  scheduler: LandingProgressTransitionScheduler = browserLandingProgressTransitionScheduler,
) {
  let currentProgress = initialProgress;
  let targetProgress = initialProgress;
  let frame: number | null = null;
  let generation = 0;
  let completionPending = false;

  const cancelScheduledFrame = () => {
    if (frame === null) return;
    scheduler.cancelFrame(frame);
    frame = null;
    generation += 1;
  };

  const complete = (applyProgress: (progress: number) => void, onComplete: () => void) => {
    currentProgress = targetProgress;
    completionPending = false;
    applyProgress(targetProgress);
    onComplete();
  };

  const setTarget = ({
    progress,
    duration,
    available,
    snap,
    applyProgress,
    onComplete,
  }: LandingProgressTransitionRequest) => {
    if (progress !== targetProgress) {
      cancelScheduledFrame();
      targetProgress = progress;
      completionPending = true;
    }
    if (!completionPending) return;
    if (snap) {
      cancelScheduledFrame();
      complete(applyProgress, onComplete);
      return;
    }
    if (!available) {
      cancelScheduledFrame();
      return;
    }
    if (currentProgress === targetProgress) {
      complete(applyProgress, onComplete);
      return;
    }
    if (frame !== null) return;
    if (duration <= 0) {
      complete(applyProgress, onComplete);
      return;
    }

    const startProgress = currentProgress;
    const startTime = scheduler.now();
    const animationGeneration = ++generation;
    const animate = (now: number) => {
      if (animationGeneration !== generation) return;
      const elapsed = Math.max(0, Math.min(1, (now - startTime) / duration));
      const eased = elapsed * elapsed * elapsed * (elapsed * (elapsed * 6 - 15) + 10);
      currentProgress = startProgress + (targetProgress - startProgress) * eased;
      if (elapsed >= 1) {
        frame = null;
        currentProgress = targetProgress;
        completionPending = false;
        applyProgress(targetProgress);
        onComplete();
        return;
      }
      applyProgress(currentProgress);
      frame = scheduler.requestFrame(animate);
    };
    frame = scheduler.requestFrame(animate);
  };

  return {
    getCurrentProgress: () => currentProgress,
    getTargetProgress: () => targetProgress,
    setTarget,
    cancelAnimation: cancelScheduledFrame,
  };
}

export function LandingPhoneMockup({
  view,
  layout,
  transparentFloor,
  startUnlockDemo = false,
  unlockDemoResetToken = 0,
  onUnlockComplete,
}: LandingPhoneMockupProps) {
  const sceneContainer = useRef<HTMLDivElement>(null);
  const phoneSceneRef = useRef<PhoneSceneController | null>(null);
  const [screenHost, setScreenHost] = useState<HTMLElement | null>(null);
  const [sceneError, setSceneError] = useState(false);
  const t = useTranslations("Home.landing.phone");

  useEffect(() => {
    const container = sceneContainer.current;
    if (!container) return;

    let disposed = false;
    let screenFrameFailed = false;
    let showcaseModelPreloadTimer: number | null = null;
    const phoneViewport = { kind: "phone" as const, viewportWidth: 390, viewportHeight: 844 };
    const screenFrame = createDeviceScreenFrame(phoneViewport);

    const failScreenFrame = () => {
      if (disposed) return;
      screenFrameFailed = true;
      phoneSceneRef.current?.cleanup();
      phoneSceneRef.current = null;
      setScreenHost(null);
      setSceneError(true);
    };
    const prepareScreenFrame = async () => {
      if (disposed) return;
      try {
        const body = await prepareDeviceScreenFrame(screenFrame, phoneViewport, failScreenFrame);
        if (disposed) return;
        if (!body) {
          failScreenFrame();
          return;
        }
        setScreenHost(body);
      } catch {
        failScreenFrame();
      }
    };

    screenFrame.addEventListener("load", prepareScreenFrame, { once: true });
    screenFrame.addEventListener("error", failScreenFrame, { once: true });
    screenFrame.srcdoc =
      '<!doctype html><html><head><meta name="viewport" content="width=390, initial-scale=1"></head><body></body></html>';

    void Promise.all([
      import("three"),
      import("three/addons/renderers/CSS3DRenderer.js"),
      import("three/addons/loaders/GLTFLoader.js"),
      import("three/addons/libs/meshopt_decoder.module.js"),
    ])
      .then(async ([three, css3d, gltfLoader, meshoptDecoder]) => {
        if (disposed || screenFrameFailed) return;
        try {
          const controller = await initializePhoneScene(
            three,
            css3d,
            gltfLoader,
            meshoptDecoder,
            container,
            screenFrame,
          );
          if (disposed || screenFrameFailed) {
            controller.cleanup();
            return;
          }
          phoneSceneRef.current = controller;
          showcaseModelPreloadTimer = window.setTimeout(() => {
            showcaseModelPreloadTimer = null;
            if (disposed) return;
            void loadLandingModel("macbook", three, gltfLoader, meshoptDecoder).catch(() => undefined);
          }, 160);
        } catch {
          if (disposed) return;
          container.replaceChildren();
          setScreenHost(null);
          setSceneError(true);
        }
      })
      .catch(() => {
        if (disposed) return;
        container.replaceChildren();
        setScreenHost(null);
        setSceneError(true);
      });

    return () => {
      disposed = true;
      if (showcaseModelPreloadTimer !== null) window.clearTimeout(showcaseModelPreloadTimer);
      screenFrame.removeEventListener("load", prepareScreenFrame);
      screenFrame.removeEventListener("error", failScreenFrame);
      phoneSceneRef.current?.cleanup();
      phoneSceneRef.current = null;
      screenFrame.remove();
    };
  }, []);

  useEffect(() => {
    // Repaint the composited layers after screen or scene-phase changes. The persistent
    // StoryEnvironment owns the backdrop in every primary-phone state.
    phoneSceneRef.current?.render();
  }, [screenHost, transparentFloor, view, startUnlockDemo, unlockDemoResetToken]);

  const hostedScreen = (
    <div className={styles.phoneScreenEntry} data-landing-phone-screen-entry={view}>
      <LandingHostedVaultScreen view={view} />
    </div>
  );
  const screen = (
    <div className={styles.phoneScreenStack} data-landing-phone-screen-stack>
      {layout === "scene" ? (
        <>
          <div
            className={styles.phoneScreenTransition}
            data-landing-phone-screen="accounts"
            data-active={view === "accounts"}
            aria-hidden={view !== "accounts"}
            inert={view !== "accounts"}
          >
            <LandingVaultsHomePreview
              startUnlockDemo={startUnlockDemo}
              unlockDemoResetToken={unlockDemoResetToken}
              onUnlockComplete={onUnlockComplete}
            />
          </div>
          {view !== "accounts" && hostedScreen}
        </>
      ) : (
        hostedScreen
      )}
    </div>
  );

  return (
    <div
      ref={sceneContainer}
      className={styles.phoneScene}
      data-layout={layout}
      data-device-model={LANDING_PHONE_MODEL_ID}
      role="img"
      aria-label={t("screenReaderLabel")}
    >
      {sceneError ? (
        <div className={styles.fallbackScene}>
          <div className={styles.phoneFallbackFrame} data-landing-phone-body-bounds data-landing-phone-fallback-frame>
            {screen}
          </div>
        </div>
      ) : (
        screenHost && createPortal(screen, screenHost)
      )}
    </div>
  );
}

export function LandingStoryEnvironment({ active }: { active: boolean }) {
  return (
    <div className={styles.storyEnvironment} data-landing-story-environment data-visible={active} aria-hidden="true" />
  );
}

export function LandingDeviceShowcase({
  progress,
  transitionDuration = 0,
  onReady,
  onTransitionComplete,
}: LandingDeviceShowcaseProps) {
  const sceneContainer = useRef<HTMLDivElement>(null);
  const sceneController = useRef<DeviceShowcaseController | null>(null);
  const [progressTransition] = useState(() => createLandingProgressTransitionDriver(progress));
  const callbacksRef = useRef({ onReady, onTransitionComplete });
  const readyNotifiedRef = useRef(false);
  const [screenPortals, setScreenPortals] = useState<ScreenPortal[]>([]);
  const [sceneInitialized, setSceneInitialized] = useState(false);
  const [sceneError, setSceneError] = useState(false);
  const t = useTranslations("Home.landing.phone");

  useEffect(() => {
    callbacksRef.current = { onReady, onTransitionComplete };
  }, [onReady, onTransitionComplete]);

  useEffect(() => {
    const container = sceneContainer.current;
    if (!container) return;

    let disposed = false;
    const screenPortals = showcaseDevices.map((device) => ({
      device,
      host: createDeviceScreenHost(device),
    }));
    const screenHosts = screenPortals.map(({ host }) => host);
    setScreenPortals(screenPortals);

    void Promise.all([
      import("three"),
      import("three/addons/renderers/CSS3DRenderer.js"),
      import("three/addons/loaders/GLTFLoader.js"),
      import("three/addons/libs/meshopt_decoder.module.js"),
    ])
      .then(async ([three, css3d, gltfLoader, meshoptDecoder]) => {
        if (disposed) {
          return;
        }
        try {
          const cleanupScene = await initializeDeviceShowcase(
            three,
            css3d,
            gltfLoader,
            meshoptDecoder,
            container,
            screenHosts,
          );
          if (disposed) {
            cleanupScene.cleanup();
            return;
          }
          sceneController.current = cleanupScene;
          cleanupScene.setProgress(progressTransition.getCurrentProgress());
          setSceneInitialized(true);
        } catch {
          if (disposed) return;
          container.replaceChildren();
          setSceneError(true);
        }
      })
      .catch(() => {
        if (disposed) return;
        container.replaceChildren();
        setSceneError(true);
      });

    return () => {
      disposed = true;
      progressTransition.cancelAnimation();
      const cleanupScene = sceneController.current;
      cleanupScene?.cleanup();
      sceneController.current = null;
      screenHosts.forEach((host) => host.remove());
      setScreenPortals([]);
    };
    // This scene is initialized once; animated scene transitions go through its controller.
  }, [progressTransition]);

  useEffect(() => {
    if (readyNotifiedRef.current) return;
    if (sceneError || (sceneInitialized && screenPortals.length === showcaseDevices.length)) {
      readyNotifiedRef.current = true;
      callbacksRef.current.onReady?.();
    }
  }, [sceneError, sceneInitialized, screenPortals.length]);

  useEffect(() => {
    const controller = sceneController.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    progressTransition.setTarget({
      progress,
      duration: transitionDuration,
      available: Boolean(controller && sceneInitialized),
      snap: sceneError || reducedMotion,
      applyProgress: (nextProgress) => {
        if (!controller) return;
        try {
          controller.setProgress(nextProgress);
        } catch {
          setSceneError(true);
        }
      },
      onComplete: () => callbacksRef.current.onTransitionComplete?.(),
    });
  }, [progressTransition, progress, sceneError, sceneInitialized, transitionDuration]);

  return (
    <div
      ref={sceneContainer}
      className={styles.phoneScene}
      data-layout="showcase"
      data-device-count={showcaseDevices.length}
      data-scene-error={sceneError}
      role="img"
      aria-label={t("deviceShowcaseScreenReaderLabel")}
    >
      {sceneError && (
        <div className={styles.showcaseFallback} aria-hidden="true">
          <div className={styles.phoneFallbackFrame}>
            <LandingHostedVaultScreen view="accounts" />
          </div>
        </div>
      )}
      {screenPortals.map(({ host, device }) =>
        createPortal(
          <div inert>
            <LandingHostedVaultScreen view={device.view} accountCount={device.accountCount} deviceKind={device.kind} />
          </div>,
          host,
          `landing-showcase-screen-${device.kind}-${device.accountCount}`,
        ),
      )}
    </div>
  );
}

function createDeviceScreenFrame(device: DeviceScreenDimensions) {
  const frame = document.createElement("iframe");
  frame.className = styles.phoneScreenFrame;
  frame.setAttribute("data-slot", "landing-phone-screen");
  frame.dataset.deviceKind = device.kind;
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.width = `${device.viewportWidth}px`;
  frame.style.height = `${device.viewportHeight}px`;
  return frame;
}

function createDeviceScreenHost(device: DeviceScreenDimensions) {
  const host = document.createElement("div");
  host.className = styles.phoneScreenFrame;
  host.setAttribute("data-slot", "landing-phone-screen");
  host.dataset.deviceKind = device.kind;
  host.setAttribute("aria-hidden", "true");
  host.inert = true;
  host.style.width = `${device.viewportWidth}px`;
  host.style.height = `${device.viewportHeight}px`;
  return host;
}

async function prepareDeviceScreenFrame(
  screenFrame: HTMLIFrameElement,
  device: Pick<DeviceScreenDimensions, "viewportWidth" | "viewportHeight">,
  onStylesheetError: () => void,
): Promise<HTMLElement | null> {
  const frameDocument = screenFrame.contentDocument;
  if (!frameDocument) return null;

  frameDocument.documentElement.lang = document.documentElement.lang;
  frameDocument.documentElement.className = document.documentElement.className;
  frameDocument.body.className = document.body.className;
  frameDocument.body.style.width = `${device.viewportWidth}px`;
  frameDocument.body.style.height = `${device.viewportHeight}px`;
  frameDocument.body.style.margin = "0";
  frameDocument.body.style.overflow = "hidden";

  const stylesheetLoads: Promise<void>[] = [];
  for (const stylesheet of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
    const clone = stylesheet.cloneNode(true);
    if (stylesheet instanceof HTMLLinkElement) {
      stylesheetLoads.push(
        new Promise((resolve) => {
          clone.addEventListener("load", () => resolve(), { once: true });
          clone.addEventListener(
            "error",
            () => {
              onStylesheetError();
              resolve();
            },
            { once: true },
          );
        }),
      );
    }
    frameDocument.head.append(clone);
  }

  let timeoutId: number | undefined;
  await Promise.race([
    Promise.all(stylesheetLoads),
    new Promise<void>((resolve) => {
      timeoutId = window.setTimeout(resolve, PHONE_SCREEN_STYLESHEET_WARMUP_MS);
    }),
  ]);
  if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  return frameDocument.body;
}

async function initializePhoneScene(
  three: ThreeRuntime,
  { CSS3DObject, CSS3DRenderer }: Css3dRuntime,
  gltfLoader: GltfLoaderRuntime,
  meshoptDecoder: MeshoptDecoderRuntime,
  container: HTMLDivElement,
  screenFrame: HTMLIFrameElement,
) {
  const phoneSource = await loadLandingModel("iphone", three, gltfLoader, meshoptDecoder);
  const scene = new three.Scene();
  scene.background = null;
  // The persistent CSS StoryEnvironment owns the background behind both device renderers.

  const camera = new three.PerspectiveCamera(48, 1, 0.1, 100);
  camera.up.set(0, 0, -1);
  camera.position.set(0, 16.5, 0);
  camera.lookAt(0, 0, 0);

  const webglRenderer = new three.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
    stencil: false,
  });
  webglRenderer.setClearColor(0x000000, 0);
  webglRenderer.outputColorSpace = three.SRGBColorSpace;
  webglRenderer.toneMapping = three.ACESFilmicToneMapping;
  webglRenderer.toneMappingExposure = 0.82;
  webglRenderer.domElement.className = styles.phoneWebglCanvas;
  webglRenderer.domElement.setAttribute("aria-hidden", "true");

  const cssRenderer = new CSS3DRenderer();
  cssRenderer.domElement.className = styles.phoneCss3dLayer;
  cssRenderer.domElement.setAttribute("aria-hidden", "true");

  const environmentTexture = createLandingStudioEnvironment(three);
  scene.environment = environmentTexture;
  scene.environmentIntensity = 0.62;

  const floorLevel = LANDING_FLOOR_LEVEL;

  const phoneCenterZ = 0;

  const phoneShadowWidth = 7.2;
  const phoneShadowHeight = 14.4;
  const phoneShadowTexture = createPhoneShadowTexture(three, phoneShadowWidth, phoneShadowHeight);
  const phoneShadowMaterial = new three.MeshBasicMaterial({
    map: phoneShadowTexture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const phoneShadow = new three.Mesh(new three.PlaneGeometry(phoneShadowWidth, phoneShadowHeight), phoneShadowMaterial);
  phoneShadow.rotation.x = -Math.PI / 2;
  phoneShadow.position.set(0.3, floorLevel + 0.004, phoneCenterZ + 0.45);
  phoneShadow.renderOrder = 2;
  scene.add(phoneShadow);

  const ambientLight = new three.HemisphereLight(0xfff7e8, 0x4a4e51, 1.35);
  const keyLight = new three.DirectionalLight(0xfffbf3, 3.4);
  keyLight.position.set(-10, 12, -8);
  const fillLight = new three.DirectionalLight(0xdde7ee, 0.58);
  fillLight.position.set(5, 9, -6);
  scene.add(ambientLight, keyLight, keyLight.target, fillLight);

  const handset = createRealPhone(three, CSS3DObject, screenFrame, phoneSource, 390, 844);
  handset.position.z = phoneCenterZ;
  handset.updateMatrixWorld(true);
  const handsetBounds = new three.Box3().setFromObject(handset);
  handset.position.y = floorLevel - handsetBounds.min.y;
  handset.updateMatrixWorld(true);
  scene.add(handset);

  // Expose the projected chassis, not the smaller CSS3D screen, to journey layout.
  handsetBounds.setFromObject(handset);
  const bodyCorners: ThreeTypes.Vector3[] = [];
  for (const x of [handsetBounds.min.x, handsetBounds.max.x]) {
    for (const y of [handsetBounds.min.y, handsetBounds.max.y]) {
      for (const z of [handsetBounds.min.z, handsetBounds.max.z]) {
        bodyCorners.push(new three.Vector3(x, y, z));
      }
    }
  }
  const bodyBounds = document.createElement("div");
  bodyBounds.className = styles.phoneBodyBounds;
  bodyBounds.dataset.landingPhoneBodyBounds = "";
  bodyBounds.setAttribute("aria-hidden", "true");
  container.append(webglRenderer.domElement, cssRenderer.domElement, bodyBounds);

  let width = 0;
  let height = 0;
  let pixelRatio = 0;
  const render = () => {
    webglRenderer.render(scene, camera);
    cssRenderer.render(scene, camera);
    const projected = bodyCorners.map((corner) => corner.clone().project(camera));
    const left = ((Math.min(...projected.map((corner) => corner.x)) + 1) * width) / 2;
    const right = ((Math.max(...projected.map((corner) => corner.x)) + 1) * width) / 2;
    const top = ((1 - Math.max(...projected.map((corner) => corner.y))) * height) / 2;
    const bottom = ((1 - Math.min(...projected.map((corner) => corner.y))) * height) / 2;
    bodyBounds.style.left = `${left}px`;
    bodyBounds.style.top = `${top}px`;
    bodyBounds.style.width = `${right - left}px`;
    bodyBounds.style.height = `${bottom - top}px`;
  };
  const resize = () => {
    const nextWidth = container.clientWidth;
    const nextHeight = container.clientHeight;
    if (nextWidth < 1 || nextHeight < 1) return;

    const nextPixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    if (nextWidth === width && nextHeight === height && nextPixelRatio === pixelRatio) return;
    width = nextWidth;
    height = nextHeight;
    pixelRatio = nextPixelRatio;

    const cameraDistance = Math.max(16.5, (16.5 * 720) / height);
    camera.position.set(0, cameraDistance, 0);
    camera.lookAt(0, 0, 0);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    webglRenderer.setPixelRatio(pixelRatio);
    webglRenderer.setSize(width, height, false);
    cssRenderer.setSize(width, height);
    render();
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  return {
    render,
    cleanup: () => {
      resizeObserver.disconnect();
      webglRenderer.dispose();
      environmentTexture?.dispose();
      phoneShadowTexture.dispose();
      phoneShadow.geometry.dispose();
      phoneShadowMaterial.dispose();
      bodyBounds.remove();
      webglRenderer.domElement.remove();
      cssRenderer.domElement.remove();
    },
  };
}

function createRealPhone(
  three: ThreeRuntime,
  CSS3DObject: Css3dRuntime["CSS3DObject"],
  screenFrame: HTMLIFrameElement,
  source: ThreeTypes.Group,
  viewportWidth: number,
  viewportHeight: number,
) {
  const handset = new three.Group();
  const orientation = new three.Group();
  const deviceModel = source.clone(true);
  deviceModel.updateMatrixWorld(true);

  const bodyBounds = new three.Box3().setFromObject(deviceModel);
  const bodySize = bodyBounds.getSize(new three.Vector3());
  const bodyCenter = bodyBounds.getCenter(new three.Vector3());
  let screenMesh: ThreeTypes.Mesh | undefined;
  deviceModel.traverse((object) => {
    if (!screenMesh && object.type === "Mesh" && /screen/i.test(object.name)) {
      screenMesh = object as ThreeTypes.Mesh;
    }
  });
  if (!screenMesh) throw new Error("The iPhone model is missing its display surface.");

  const displayBounds = new three.Box3().setFromObject(screenMesh);
  const displaySize = displayBounds.getSize(new three.Vector3());
  const displayCenter = displayBounds.getCenter(new three.Vector3());
  screenMesh.visible = false;
  deviceModel.traverse((object) => {
    if (object.type === "Mesh" && /_(?:glass|black|Material\.007)_/i.test(object.name)) {
      object.visible = false;
    }
  });
  const scale = new three.Vector3(0.3 / bodySize.x, 9.08 / bodySize.y, 4.3 / bodySize.z);
  deviceModel.scale.copy(scale);
  deviceModel.position.set(-bodyCenter.x * scale.x, -bodyCenter.y * scale.y, -bodyCenter.z * scale.z);

  const screen = new CSS3DObject(screenFrame);
  screen.position.set(displayCenter.x - 0.0015 / scale.x, displayCenter.y, displayCenter.z);
  screen.rotation.y = -Math.PI / 2;
  screen.scale.set((displaySize.z * 0.93) / viewportWidth, (displaySize.y * 0.93) / viewportHeight, 1);
  deviceModel.add(screen);

  const axes = new three.Matrix4().makeBasis(
    new three.Vector3(0, -1, 0),
    new three.Vector3(0, 0, -1),
    new three.Vector3(1, 0, 0),
  );
  orientation.quaternion.setFromRotationMatrix(axes);
  orientation.add(deviceModel);
  handset.add(orientation);
  return handset;
}

function createRealLaptop(
  three: ThreeRuntime,
  CSS3DObject: Css3dRuntime["CSS3DObject"],
  screenHost: HTMLElement,
  source: ThreeTypes.Group,
  viewportWidth: number,
  viewportHeight: number,
  keepMaterial: <T extends ThreeTypes.Material>(material: T) => T,
) {
  const laptop = new three.Group();
  const deviceModel = source.clone(true);
  deviceModel.updateMatrixWorld(true);

  const bodyBounds = new three.Box3().setFromObject(deviceModel);
  const bodySize = bodyBounds.getSize(new three.Vector3());
  const bodyCenter = bodyBounds.getCenter(new three.Vector3());
  let displayMesh: ThreeTypes.Mesh | undefined;
  let displayArea = 0;
  deviceModel.traverse((object) => {
    if (object.type !== "Mesh") return;
    const mesh = object as ThreeTypes.Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const hasDisplaySurface = materials.some(
      (material) =>
        material instanceof three.MeshStandardMaterial &&
        (material.emissiveMap !== null || material.emissiveIntensity >= 2),
    );
    if (!hasDisplaySurface) return;

    const candidateBounds = new three.Box3().setFromObject(mesh);
    const size = candidateBounds.getSize(new three.Vector3());
    const area = size.x * size.y + size.y * size.z + size.z * size.x;
    if (area <= displayArea) return;
    displayMesh = mesh;
    displayArea = area;
  });
  if (!displayMesh) throw new Error("The MacBook model is missing its display surface.");

  // Cloned GLTF scenes share material references, so isolate this screen before removing its baked-in display texture.
  const isolatedDisplayMaterials = Array.isArray(displayMesh.material)
    ? displayMesh.material.map((material) => material.clone())
    : displayMesh.material.clone();
  displayMesh.material = isolatedDisplayMaterials;
  const displayMaterials = Array.isArray(isolatedDisplayMaterials)
    ? isolatedDisplayMaterials
    : [isolatedDisplayMaterials];
  displayMaterials.forEach(keepMaterial);
  for (const material of displayMaterials) {
    if (!(material instanceof three.MeshStandardMaterial)) continue;
    material.map = null;
    material.emissiveMap = null;
    material.color.set(0xf8f4ed);
    material.emissive.set(0x000000);
    material.emissiveIntensity = 0;
    material.metalness = 0;
    material.roughness = 0.82;
    material.needsUpdate = true;
  }

  displayMesh.geometry.computeBoundingBox();
  const displayLocalBounds = displayMesh.geometry.boundingBox;
  if (!displayLocalBounds) throw new Error("The MacBook display is missing its local bounds.");
  const screenGeometry = displayMesh.geometry;
  const screenPositions = screenGeometry.getAttribute("position");
  const screenNormals = screenGeometry.getAttribute("normal");
  if (!screenPositions || !screenNormals) throw new Error("The MacBook display surface is incomplete.");

  const screenNormal = new three.Vector3();
  for (let index = 0; index < screenNormals.count; index += 1) {
    screenNormal.add(new three.Vector3().fromBufferAttribute(screenNormals, index));
  }
  screenNormal.normalize();

  const screenRight = new three.Vector3(1, 0, 0).projectOnPlane(screenNormal).normalize();
  const screenUp = new three.Vector3().crossVectors(screenNormal, screenRight).normalize();
  const screenMin = new three.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  const screenMax = new three.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
  for (let index = 0; index < screenPositions.count; index += 1) {
    const vertex = new three.Vector3().fromBufferAttribute(screenPositions, index);
    const projected = new three.Vector3(vertex.dot(screenRight), vertex.dot(screenUp), vertex.dot(screenNormal));
    screenMin.min(projected);
    screenMax.max(projected);
  }

  const displayWidth = screenMax.x - screenMin.x;
  const displayHeight = screenMax.y - screenMin.y;
  const displayCenter = screenRight
    .clone()
    .multiplyScalar((screenMin.x + screenMax.x) / 2)
    .addScaledVector(screenUp, (screenMin.y + screenMax.y) / 2)
    .addScaledVector(screenNormal, screenMax.z + 0.001);
  const screenOrientation = new three.Matrix4().makeBasis(screenRight, screenUp, screenNormal);
  const scale = 9.6 / bodySize.x;
  deviceModel.scale.setScalar(scale);
  deviceModel.position.set(-bodyCenter.x * scale, -bodyBounds.min.y * scale, -bodyCenter.z * scale);

  const screen = new CSS3DObject(screenHost);
  screen.position.copy(displayCenter);
  screen.quaternion.setFromRotationMatrix(screenOrientation);
  screen.scale.set((displayWidth / viewportWidth) * 0.985, (displayHeight / viewportHeight) * 0.985, 1);
  displayMesh.add(screen);
  laptop.add(deviceModel);
  return laptop;
}

async function initializeDeviceShowcase(
  three: ThreeRuntime,
  { CSS3DObject, CSS3DRenderer }: Css3dRuntime,
  gltfLoader: GltfLoaderRuntime,
  meshoptDecoder: MeshoptDecoderRuntime,
  container: HTMLDivElement,
  screenHosts: HTMLElement[],
): Promise<DeviceShowcaseController> {
  const laptopSource = await loadLandingModel("macbook", three, gltfLoader, meshoptDecoder);
  const scene = new three.Scene();
  scene.background = null;

  const camera = new three.PerspectiveCamera(48, 1, 0.1, 140);
  const topCamera = new three.PerspectiveCamera(48, 1, 0.1, 140);
  topCamera.up.set(0, 0, -1);
  topCamera.position.set(0, 16.5, 0.01);
  topCamera.lookAt(0, 0, 0);
  const sideCamera = new three.PerspectiveCamera(44, 1, 0.1, 140);
  sideCamera.up.set(0, 1, 0);
  sideCamera.position.set(0, 18, 25);
  sideCamera.lookAt(0, 0, 0);
  const compactSideCamera = new three.PerspectiveCamera(44, 1, 0.1, 140);
  compactSideCamera.up.set(0, 1, 0);
  compactSideCamera.position.set(0, 30, 15);
  compactSideCamera.lookAt(0, 0, 0);
  const topRotation = topCamera.quaternion.clone();
  const sideRotation = sideCamera.quaternion.clone();
  const compactSideRotation = compactSideCamera.quaternion.clone();
  const topPosition = new three.Vector3(0, 16.5, 0.01);
  const sidePosition = new three.Vector3(0, 18, 25);
  const compactSidePosition = new three.Vector3(0, 30, 15);
  const nextCameraPosition = new three.Vector3();
  const cameraBounds = new three.Box3();
  const deviceBounds = new three.Box3();
  const cameraBoundsPoints: LandingCameraFitVector[] = [];
  const progressApplier = createLandingShowcaseProgressApplier(applyProgress);

  const webglRenderer = new three.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
    stencil: false,
  });
  webglRenderer.setClearColor(0x000000, 0);
  webglRenderer.outputColorSpace = three.SRGBColorSpace;
  webglRenderer.toneMapping = three.ACESFilmicToneMapping;
  webglRenderer.toneMappingExposure = 0.78;
  webglRenderer.domElement.className = styles.phoneWebglCanvas;
  webglRenderer.domElement.setAttribute("aria-hidden", "true");

  const cssRenderer = new CSS3DRenderer();
  cssRenderer.domElement.className = styles.phoneCss3dLayer;
  cssRenderer.domElement.setAttribute("aria-hidden", "true");

  const environmentTexture = createLandingStudioEnvironment(three);
  scene.environment = environmentTexture;
  scene.environmentIntensity = 0.58;

  const ambientLight = new three.HemisphereLight(0xfff7e8, 0x4a4e51, 1.15);
  const keyLight = new three.DirectionalLight(0xfffbf3, 3.1);
  keyLight.position.set(-10, 16, -10);
  const fillLight = new three.DirectionalLight(0xdde7ee, 0.42);
  fillLight.position.set(11, 10, 8);
  scene.add(ambientLight, keyLight, fillLight);

  const geometries: ThreeTypes.BufferGeometry[] = [];
  const materials: ThreeTypes.Material[] = [];
  const textures: ThreeTypes.Texture[] = [];
  const keepGeometry = <T extends ThreeTypes.BufferGeometry>(geometry: T) => {
    geometries.push(geometry);
    return geometry;
  };
  const keepMaterial = <T extends ThreeTypes.Material>(material: T) => {
    materials.push(material);
    return material;
  };
  const keepTexture = <T extends ThreeTypes.Texture>(texture: T) => {
    textures.push(texture);
    return texture;
  };
  const extrudedRoundedRectangle = (width: number, height: number, radius: number, depth: number) => {
    const geometry = keepGeometry(
      new three.ExtrudeGeometry(roundedRectangle(three, width, height, radius), {
        depth,
        bevelEnabled: true,
        bevelSegments: 5,
        bevelThickness: Math.min(0.045, depth * 0.22),
        bevelSize: Math.min(0.04, depth * 0.2),
        curveSegments: 10,
        steps: 1,
      }),
    );
    geometry.translate(0, 0, -depth / 2);
    return geometry;
  };

  const deviceAluminumMaterial = keepMaterial(
    new three.MeshStandardMaterial({ color: 0x828a90, metalness: 0.88, roughness: 0.24 }),
  );
  const deviceEdgeMaterial = keepMaterial(
    new three.MeshStandardMaterial({ color: 0xb8bec2, metalness: 0.9, roughness: 0.19 }),
  );
  const deviceGlassMaterial = keepMaterial(
    new three.MeshPhysicalMaterial({
      color: 0x11161a,
      metalness: 0.02,
      roughness: 0.13,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
    }),
  );
  const cameraMaterial = keepMaterial(
    new three.MeshPhysicalMaterial({ color: 0x080b0d, metalness: 0.24, roughness: 0.12, clearcoat: 1 }),
  );
  const tabletButtonGeometry = keepGeometry(extrudedRoundedRectangle(0.38, 0.1, 0.05, 0.07));
  const tabletCameraRingMaterial = keepMaterial(
    new three.MeshStandardMaterial({ color: 0x565f66, metalness: 0.72, roughness: 0.24 }),
  );
  const tabletCameraRingGeometry = keepGeometry(new three.CylinderGeometry(0.046, 0.046, 0.012, 48));
  const tabletLensGeometry = keepGeometry(new three.CylinderGeometry(0.029, 0.029, 0.016, 48));
  const tabletSpeakerGeometry = keepGeometry(new three.CylinderGeometry(0.018, 0.018, 0.024, 16));

  const makeFlatSurface = (
    parent: ThreeTypes.Group,
    width: number,
    depth: number,
    radius: number,
    material: ThreeTypes.Material,
    x: number,
    y: number,
    z: number,
    orientation: "horizontal" | "vertical" = "horizontal",
  ) => {
    const surface = new three.Mesh(
      keepGeometry(new three.ShapeGeometry(roundedRectangle(three, width, depth, radius), 12)),
      material,
    );
    surface.rotation.x = orientation === "horizontal" ? -Math.PI / 2 : 0;
    surface.position.set(x, y, z);
    parent.add(surface);
    return surface;
  };

  const makeTablet = (screenHost: HTMLElement) => {
    const tablet = new three.Group();
    const shell = new three.Mesh(extrudedRoundedRectangle(9.55, 7.16, 0.66, 0.2), deviceAluminumMaterial);
    shell.rotation.x = -Math.PI / 2;
    shell.position.y = 0.1;
    tablet.add(shell);

    makeFlatSurface(tablet, 9.4, 7.01, 0.62, deviceEdgeMaterial, 0, 0.201, 0);
    makeFlatSurface(tablet, 9.27, 6.88, 0.57, deviceGlassMaterial, 0, 0.204, 0);

    const screen = new CSS3DObject(screenHost);
    screen.position.set(0, 0.207, 0);
    screen.rotation.x = -Math.PI / 2;
    screen.scale.set(9.08 / 1024, 6.79 / 768, 1);
    tablet.add(screen);

    const sideButtons = [
      new three.Mesh(tabletButtonGeometry, deviceAluminumMaterial),
      new three.Mesh(tabletButtonGeometry, deviceAluminumMaterial),
    ];
    sideButtons[0].rotation.y = Math.PI / 2;
    sideButtons[1].rotation.y = Math.PI / 2;
    sideButtons[0].position.set(4.78, 0.115, -2.12);
    sideButtons[1].position.set(4.78, 0.115, -1.66);
    sideButtons.forEach((button) => tablet.add(button));

    const cameraRing = new three.Mesh(tabletCameraRingGeometry, tabletCameraRingMaterial);
    cameraRing.position.set(0, 0.214, -3.47);
    tablet.add(cameraRing);

    const cameraLens = new three.Mesh(tabletLensGeometry, cameraMaterial);
    cameraLens.position.set(0, 0.224, -3.47);
    tablet.add(cameraLens);

    const chargingPort = new three.Mesh(
      keepGeometry(new three.ShapeGeometry(roundedRectangle(three, 0.34, 0.075, 0.037), 12)),
      cameraMaterial,
    );
    chargingPort.position.set(0, 0.1, 3.574);
    tablet.add(chargingPort);

    for (const speakerX of [-0.42, -0.3, -0.18, 0.18, 0.3, 0.42]) {
      const speaker = new three.Mesh(tabletSpeakerGeometry, cameraMaterial);
      speaker.rotation.x = Math.PI / 2;
      speaker.position.set(speakerX, 0.1, 3.565);
      tablet.add(speaker);
    }
    return tablet;
  };

  const floorNormalAxis = new three.Vector3(0, 1, 0);
  const shadowDimensions: Record<
    LandingDeviceKind,
    Readonly<{
      bodyWidth: number;
      bodyHeight: number;
      planeWidth: number;
      planeHeight: number;
    }>
  > = {
    phone: { bodyWidth: 4.3, bodyHeight: 9.08, planeWidth: 7, planeHeight: 13 },
    tablet: { bodyWidth: 9.55, bodyHeight: 7.16, planeWidth: 12.2, planeHeight: 10.4 },
    laptop: { bodyWidth: 9.6, bodyHeight: 6.55, planeWidth: 12.4, planeHeight: 10.8 },
  };
  const shadowResources = new Map<
    LandingDeviceKind,
    {
      soft: { geometry: ThreeTypes.BufferGeometry; material: ThreeTypes.MeshBasicMaterial };
      contact: { geometry: ThreeTypes.BufferGeometry; material: ThreeTypes.MeshBasicMaterial };
    }
  >();
  const getShadowResource = (kind: LandingDeviceKind) => {
    const existing = shadowResources.get(kind);
    if (existing) return existing;
    const dimensions = shadowDimensions[kind];
    const contactPlaneWidth = dimensions.bodyWidth * 1.28;
    const contactPlaneHeight = dimensions.bodyHeight * 1.28;
    const createShadowLayer = (planeWidth: number, planeHeight: number, blur: number, opacity: number) => {
      const texture = keepTexture(
        createPhoneShadowTexture(
          three,
          planeWidth,
          planeHeight,
          dimensions.bodyWidth,
          dimensions.bodyHeight,
          blur,
          opacity,
        ),
      );
      return {
        geometry: keepGeometry(new three.PlaneGeometry(planeWidth, planeHeight)),
        material: keepMaterial(
          new three.MeshBasicMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
            toneMapped: false,
          }),
        ) as ThreeTypes.MeshBasicMaterial,
      };
    };
    const resource = {
      soft: createShadowLayer(dimensions.planeWidth, dimensions.planeHeight, 34, 0.27),
      contact: createShadowLayer(contactPlaneWidth, contactPlaneHeight, 12, 0.34),
    };
    shadowResources.set(kind, resource);
    return resource;
  };

  const devices = showcaseDevices.flatMap((spec, index) => {
    const screenHost = screenHosts[index];
    if (!screenHost) return [];
    const handset = new three.Group();
    handset.rotateOnWorldAxis(floorNormalAxis, spec.yaw);

    if (spec.kind === "tablet") {
      handset.add(makeTablet(screenHost));
    }

    if (spec.kind === "laptop") {
      handset.add(
        createRealLaptop(
          three,
          CSS3DObject,
          screenHost,
          laptopSource,
          spec.viewportWidth,
          spec.viewportHeight,
          keepMaterial,
        ),
      );
    }

    handset.updateMatrixWorld(true);
    const boundsAtUnitScale = new three.Box3().setFromObject(handset);
    const floorOffset = boundsAtUnitScale.min.y;
    handset.position.set(spec.x, LANDING_FLOOR_LEVEL - floorOffset * spec.scale, spec.z);
    handset.scale.setScalar(spec.scale);
    handset.updateMatrixWorld(true);

    const shadowResource = getShadowResource(spec.kind);
    const shadow = new three.Mesh(shadowResource.soft.geometry, shadowResource.soft.material);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(spec.x + 0.22, LANDING_FLOOR_LEVEL + 0.003, spec.z + 0.35);
    shadow.scale.setScalar(spec.scale);
    shadow.renderOrder = 2;
    const contactShadow = new three.Mesh(shadowResource.contact.geometry, shadowResource.contact.material);
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.set(spec.x + 0.08, LANDING_FLOOR_LEVEL + 0.004, spec.z + 0.12);
    contactShadow.scale.setScalar(spec.scale);
    contactShadow.renderOrder = 3;
    scene.add(handset, shadow, contactShadow);
    return [
      {
        handset,
        shadow,
        contactShadow,
        spec,
        floorOffset,
        exitDirection: new three.Vector2(spec.x, spec.z).normalize(),
      },
    ];
  });

  container.append(webglRenderer.domElement, cssRenderer.domElement);

  let width = 0;
  let height = 0;
  let pixelRatio = 0;
  let framingDistanceOffset = 0;
  let framingViewportDirty = true;
  const render = () => {
    webglRenderer.render(scene, camera);
    cssRenderer.render(scene, camera);
  };
  const resize = () => {
    const nextWidth = container.clientWidth;
    const nextHeight = container.clientHeight;
    if (nextWidth < 1 || nextHeight < 1) return;

    const nextPixelRatio = Math.min(window.devicePixelRatio || 1, 1.35);
    if (nextWidth === width && nextHeight === height && nextPixelRatio === pixelRatio) return;
    width = nextWidth;
    height = nextHeight;
    pixelRatio = nextPixelRatio;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    webglRenderer.setPixelRatio(pixelRatio);
    webglRenderer.setSize(width, height, false);
    cssRenderer.setSize(width, height);
    framingViewportDirty = true;
    if (!progressApplier.reapply()) render();
  };
  // Warm the expanded view before it is shown. Three's material compile pass does not
  // prepare the environment map or guarantee that the actual view has rendered, so the
  // first side-camera frame would otherwise stall the scroll transition with shader and
  // PMREM setup.
  camera.position.copy(sidePosition);
  camera.quaternion.copy(sideRotation);
  camera.fov = sideCamera.fov;
  camera.updateProjectionMatrix();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  function applyProgress(progress: number, renderFrame = true) {
    // One eased progress moves the camera, device positions, and scales together from the center.
    const expanded = Math.max(0, Math.min(1, progress * 2));
    const leaving = Math.max(0, Math.min(1, (progress - 0.5) * 2));
    if (framingViewportDirty && leaving > 0) {
      // Refit the expanded reference pose before replaying departure for the new viewport.
      // Do not draw the reference: only the requested pose should reach the compositor.
      applyProgress(0.5, false);
    }
    const compactLayout = width <= 900;
    const nextSidePosition = compactLayout ? compactSidePosition : sidePosition;
    const nextSideRotation = compactLayout ? compactSideRotation : sideRotation;
    const sideAmount = expanded * (1 - leaving);
    const baseCameraPosition = nextCameraPosition.lerpVectors(topPosition, nextSidePosition, sideAmount);
    camera.position.copy(baseCameraPosition);
    camera.quaternion.slerpQuaternions(topRotation, nextSideRotation, sideAmount);
    camera.fov = 48 - 4 * sideAmount;
    camera.updateProjectionMatrix();

    const horizontalScale = compactLayout ? 0.62 : 1;
    const depthScale = compactLayout ? 4 : 1;
    const exitSpread = compactLayout ? 9 : 15;

    devices.forEach(({ handset, shadow, contactShadow, spec, floorOffset, exitDirection }) => {
      const x = spec.x * horizontalScale * expanded + exitDirection.x * exitSpread * leaving;
      const z = spec.z * depthScale * expanded + exitDirection.y * exitSpread * leaving;
      const scale = spec.scale * expanded * (1 - leaving);
      handset.position.set(x, LANDING_FLOOR_LEVEL - floorOffset * scale, z);
      handset.scale.setScalar(scale);
      handset.visible = scale > 0.001;
      handset.rotation.set(0, 0, 0);
      handset.rotateOnWorldAxis(floorNormalAxis, spec.yaw * expanded * (1 - leaving));
      shadow.position.set(x + 0.25, LANDING_FLOOR_LEVEL + 0.004, z + 0.45);
      shadow.scale.setScalar(scale);
      shadow.visible = scale > 0.001;
      contactShadow.position.set(x + 0.08, LANDING_FLOOR_LEVEL + 0.005, z + 0.12);
      contactShadow.scale.setScalar(scale);
      contactShadow.visible = scale > 0.001;
    });

    fitCameraToDeviceBounds(baseCameraPosition.length(), leaving);
    camera.updateMatrixWorld();
    if (renderFrame) render();
  }

  function fitCameraToDeviceBounds(baseDistance: number, leaving: number) {
    if (leaving !== 0) {
      // Carry the responsive framing into departure instead of snapping to the unfitted camera.
      camera.position.setLength(baseDistance + framingDistanceOffset * (1 - leaving));
      return;
    }
    framingViewportDirty = false;
    cameraBounds.makeEmpty();
    devices.forEach(({ handset }) => {
      if (!handset.visible) return;
      handset.updateMatrixWorld(true);
      cameraBounds.union(deviceBounds.setFromObject(handset));
    });
    if (cameraBounds.isEmpty()) {
      framingDistanceOffset = 0;
      return;
    }

    cameraBoundsPoints.length = 0;
    for (const x of [cameraBounds.min.x, cameraBounds.max.x]) {
      for (const y of [cameraBounds.min.y, cameraBounds.max.y]) {
        for (const z of [cameraBounds.min.z, cameraBounds.max.z]) cameraBoundsPoints.push({ x, y, z });
      }
    }
    const cameraRight = new three.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const cameraUp = new three.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const cameraPositionDirection = new three.Vector3(0, 0, 1).applyQuaternion(camera.quaternion).normalize();
    const fittedDistance = getLandingShowcaseCameraDistance({
      points: cameraBoundsPoints,
      viewportWidth: width,
      viewportHeight: height,
      verticalFovDegrees: camera.fov,
      cameraRight,
      cameraUp,
      cameraPositionDirection,
    });
    framingDistanceOffset = Math.max(0, fittedDistance - baseDistance);
    camera.position.copy(cameraPositionDirection.multiplyScalar(baseDistance + framingDistanceOffset));
  }

  return {
    setProgress: progressApplier.setProgress,
    cleanup: () => {
      resizeObserver.disconnect();
      webglRenderer.dispose();
      textures.forEach((texture) => texture.dispose());
      environmentTexture?.dispose();
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      container.replaceChildren();
    },
  };
}

function roundedRectangle(three: ThreeRuntime, width: number, height: number, radius: number) {
  const left = -width / 2;
  const right = width / 2;
  const top = height / 2;
  const bottom = -height / 2;
  const shape = new three.Shape();
  shape.moveTo(left + radius, bottom);
  shape.lineTo(right - radius, bottom);
  shape.quadraticCurveTo(right, bottom, right, bottom + radius);
  shape.lineTo(right, top - radius);
  shape.quadraticCurveTo(right, top, right - radius, top);
  shape.lineTo(left + radius, top);
  shape.quadraticCurveTo(left, top, left, top - radius);
  shape.lineTo(left, bottom + radius);
  shape.quadraticCurveTo(left, bottom, left + radius, bottom);
  return shape;
}

function createPhoneShadowTexture(
  three: ThreeRuntime,
  planeWidth: number,
  planeHeight: number,
  bodyWidth = 4.3,
  bodyHeight = 9.08,
  blurRadius = 28,
  opacity = 0.32,
) {
  const canvas = document.createElement("canvas");
  canvas.width = planeWidth >= planeHeight ? 1024 : 512;
  canvas.height = planeWidth >= planeHeight ? 768 : 1024;
  const context = canvas.getContext("2d");
  if (context) {
    const width = (bodyWidth / planeWidth) * canvas.width;
    const height = (bodyHeight / planeHeight) * canvas.height;
    const x = (canvas.width - width) / 2;
    const y = (canvas.height - height) / 2;
    const radius = (0.5 / bodyWidth) * width;
    context.save();
    context.filter = `blur(${blurRadius}px)`;
    context.fillStyle = `rgba(25, 31, 36, ${opacity})`;
    context.beginPath();
    context.moveTo(x + radius, y);
    context.lineTo(x + width - radius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + radius);
    context.lineTo(x + width, y + height - radius);
    context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    context.lineTo(x + radius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - radius);
    context.lineTo(x, y + radius);
    context.quadraticCurveTo(x, y, x + radius, y);
    context.closePath();
    context.fill();
    context.restore();
  }

  const texture = new three.CanvasTexture(canvas);
  texture.colorSpace = three.SRGBColorSpace;
  return texture;
}
