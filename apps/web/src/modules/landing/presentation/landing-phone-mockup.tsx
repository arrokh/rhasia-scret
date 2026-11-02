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
  setTransparentFloor: (transparent: boolean) => void;
  cleanup: () => void;
}>;

type LandingDeviceShowcaseProps = Readonly<{
  progress: number;
  transitionDuration?: number;
  onReady?: () => void;
  onTransitionComplete?: () => void;
}>;

export function LandingPhoneMockup({
  view,
  layout,
  transparentFloor = false,
  startUnlockDemo = false,
  unlockDemoResetToken = 0,
  onUnlockComplete,
}: LandingPhoneMockupProps) {
  const sceneContainer = useRef<HTMLDivElement>(null);
  const phoneSceneRef = useRef<PhoneSceneController | null>(null);
  const transparentFloorRef = useRef(transparentFloor);
  const [screenHost, setScreenHost] = useState<HTMLElement | null>(null);
  const [sceneError, setSceneError] = useState(false);
  const t = useTranslations("Home.landing.phone");

  useEffect(() => {
    const container = sceneContainer.current;
    if (!container) return;

    let disposed = false;
    let showcaseModelPreloadTimer: number | null = null;
    const phoneViewport = { kind: "phone" as const, viewportWidth: 390, viewportHeight: 844 };
    const screenFrame = createDeviceScreenFrame(phoneViewport);

    const prepareScreenFrame = async () => {
      if (disposed) return;
      const body = await prepareDeviceScreenFrame(screenFrame, phoneViewport);
      if (disposed) return;
      if (body) setScreenHost(body);
    };

    screenFrame.addEventListener("load", prepareScreenFrame, { once: true });
    screenFrame.srcdoc =
      '<!doctype html><html><head><meta name="viewport" content="width=390, initial-scale=1"></head><body></body></html>';

    void Promise.all([
      import("three"),
      import("three/addons/renderers/CSS3DRenderer.js"),
      import("three/addons/loaders/GLTFLoader.js"),
      import("three/addons/libs/meshopt_decoder.module.js"),
    ])
      .then(async ([three, css3d, gltfLoader, meshoptDecoder]) => {
        if (disposed) return;
        try {
          const controller = await initializePhoneScene(
            three,
            css3d,
            gltfLoader,
            meshoptDecoder,
            container,
            screenFrame,
          );
          if (disposed) {
            controller.cleanup();
            return;
          }
          phoneSceneRef.current = controller;
          controller.setTransparentFloor(transparentFloorRef.current);
          showcaseModelPreloadTimer = window.setTimeout(() => {
            showcaseModelPreloadTimer = null;
            if (disposed) return;
            void loadLandingModel("macbook", three, gltfLoader, meshoptDecoder).catch(() => undefined);
          }, 160);
        } catch {
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
      phoneSceneRef.current?.cleanup();
      phoneSceneRef.current = null;
      screenFrame.remove();
      setScreenHost(null);
    };
  }, []);

  useEffect(() => {
    transparentFloorRef.current = transparentFloor;
    phoneSceneRef.current?.setTransparentFloor(transparentFloor);
  }, [transparentFloor]);

  const screen =
    layout === "scene" ? (
      <>
        <div hidden={view !== "accounts"}>
          <LandingVaultsHomePreview
            startUnlockDemo={startUnlockDemo}
            unlockDemoResetToken={unlockDemoResetToken}
            onUnlockComplete={onUnlockComplete}
          />
        </div>
        {view !== "accounts" && <LandingHostedVaultScreen view={view} />}
      </>
    ) : (
      <LandingHostedVaultScreen view={view} />
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
          <div className={styles.phoneFallbackFrame}>{screen}</div>
        </div>
      ) : (
        screenHost && createPortal(screen, screenHost)
      )}
    </div>
  );
}

export function LandingStoryEnvironment({ active }: { active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderEnvironmentRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;
    let cleanupScene = () => undefined;

    void import("three")
      .then((three) => {
        if (disposed) return;

        const scene = new three.Scene();
        scene.background = new three.Color(0xf8f4ed);

        const camera = new three.PerspectiveCamera(48, 1, 0.1, 120);
        camera.up.set(0, 0, -1);
        camera.position.set(0, 16.5, 0);
        camera.lookAt(0, 0, 0);

        const renderer = new three.WebGLRenderer({
          alpha: false,
          antialias: true,
          powerPreference: "low-power",
          stencil: false,
        });
        renderer.setClearColor(0xf8f4ed, 1);
        renderer.outputColorSpace = three.SRGBColorSpace;
        renderer.toneMapping = three.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1;
        renderer.domElement.className = styles.storyEnvironmentCanvas;
        renderer.domElement.setAttribute("aria-hidden", "true");
        container.append(renderer.domElement);

        const floorTexture = createFloorTexture(three);
        const floorMaterial = new three.MeshStandardMaterial({ map: floorTexture, roughness: 1, metalness: 0 });
        const floor = new three.Mesh(new three.PlaneGeometry(120, 120), floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = LANDING_FLOOR_LEVEL;
        scene.add(floor);

        const ambientLight = new three.HemisphereLight(0xfff7e8, 0x4a4e51, 1.8);
        const keyLight = new three.DirectionalLight(0xfffbf3, 4.2);
        keyLight.position.set(-10, 12, -8);
        scene.add(ambientLight, keyLight, keyLight.target);

        const render = () => renderer.render(scene, camera);
        renderEnvironmentRef.current = render;
        const resize = () => {
          if (disposed) return;
          const width = container.clientWidth;
          const height = container.clientHeight;
          if (width < 1 || height < 1) return;
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
          renderer.setSize(width, height, false);
          render();
        };

        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(container);
        resize();
        cleanupScene = () => {
          resizeObserver?.disconnect();
          renderer.dispose();
          floorTexture.dispose();
          floor.geometry.dispose();
          floorMaterial.dispose();
          container.replaceChildren();
          renderEnvironmentRef.current = () => undefined;
        };
      })
      .catch(() => {
        if (!disposed) container.replaceChildren();
      });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      cleanupScene();
    };
  }, []);

  useEffect(() => {
    if (active) renderEnvironmentRef.current();
  }, [active]);

  return (
    <div
      ref={containerRef}
      className={styles.storyEnvironment}
      data-landing-story-environment
      data-visible={active}
      aria-hidden="true"
    />
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
  const progressRef = useRef(progress);
  const transitionFrameRef = useRef<number | null>(null);
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
          cleanupScene.setProgress(progressRef.current);
          setSceneInitialized(true);
        } catch {
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
      if (transitionFrameRef.current !== null) {
        cancelAnimationFrame(transitionFrameRef.current);
        transitionFrameRef.current = null;
      }
      const cleanupScene = sceneController.current;
      cleanupScene?.cleanup();
      sceneController.current = null;
      screenHosts.forEach((host) => host.remove());
      setScreenPortals([]);
    };
    // This scene is initialized once; animated scene transitions go through its controller.
  }, []);

  useEffect(() => {
    if (readyNotifiedRef.current) return;
    if (sceneError || (sceneInitialized && screenPortals.length === showcaseDevices.length)) {
      readyNotifiedRef.current = true;
      callbacksRef.current.onReady?.();
    }
  }, [sceneError, sceneInitialized, screenPortals.length]);

  useEffect(() => {
    if (progressRef.current === progress) return;
    if (transitionFrameRef.current !== null) {
      cancelAnimationFrame(transitionFrameRef.current);
      transitionFrameRef.current = null;
    }

    const controller = sceneController.current;
    if (sceneError) {
      progressRef.current = progress;
      callbacksRef.current.onTransitionComplete?.();
      return;
    }
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion && (!controller || !sceneInitialized)) {
      progressRef.current = progress;
      callbacksRef.current.onTransitionComplete?.();
      return;
    }
    if (!controller || !sceneInitialized) return;

    const finishTransition = () => {
      progressRef.current = progress;
      controller.setProgress(progress);
      transitionFrameRef.current = null;
      callbacksRef.current.onTransitionComplete?.();
    };
    if (transitionDuration <= 0 || reducedMotion) {
      finishTransition();
      return;
    }

    const startProgress = progressRef.current;
    const startTime = performance.now();
    const animate = (now: number) => {
      const elapsed = Math.min(1, (now - startTime) / transitionDuration);
      const eased = elapsed < 0.5 ? 4 * elapsed * elapsed * elapsed : 1 - Math.pow(-2 * elapsed + 2, 3) / 2;
      const nextProgress = startProgress + (progress - startProgress) * eased;
      progressRef.current = nextProgress;
      controller.setProgress(nextProgress);
      if (elapsed >= 1) {
        transitionFrameRef.current = null;
        callbacksRef.current.onTransitionComplete?.();
        return;
      }
      transitionFrameRef.current = requestAnimationFrame(animate);
    };
    transitionFrameRef.current = requestAnimationFrame(animate);
  }, [progress, sceneError, sceneInitialized, transitionDuration]);

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
          clone.addEventListener("error", () => resolve(), { once: true });
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
  const isStoryScene = container.dataset.layout === "story";
  const scene = new three.Scene();
  const background = new three.Color(0xf8f4ed);
  if (!isStoryScene) scene.background = background;

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
  webglRenderer.setClearColor(0xf8f4ed, isStoryScene ? 0 : 1);
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

  const floorTexture = isStoryScene ? null : createFloorTexture(three);
  const floorMaterial = floorTexture
    ? new three.MeshStandardMaterial({ map: floorTexture, roughness: 1, metalness: 0 })
    : null;
  const floor = floorMaterial ? new three.Mesh(new three.PlaneGeometry(120, 120), floorMaterial) : null;
  const floorLevel = LANDING_FLOOR_LEVEL;
  if (floor) {
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = floorLevel;
    scene.add(floor);
  }

  const phoneCenterZ = -0.85;

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

  container.append(webglRenderer.domElement, cssRenderer.domElement);

  let width = 0;
  let height = 0;
  let pixelRatio = 0;
  const render = () => {
    webglRenderer.render(scene, camera);
    cssRenderer.render(scene, camera);
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
    setTransparentFloor: (transparent: boolean) => {
      const transparentScene = isStoryScene || transparent;
      scene.background = transparentScene ? null : background;
      if (floor) floor.visible = !transparentScene;
      webglRenderer.setClearColor(0xf8f4ed, transparentScene ? 0 : 1);
      render();
    },
    cleanup: () => {
      resizeObserver.disconnect();
      webglRenderer.dispose();
      environmentTexture?.dispose();
      floorTexture?.dispose();
      phoneShadowTexture.dispose();
      floor?.geometry.dispose();
      floorMaterial?.dispose();
      phoneShadow.geometry.dispose();
      phoneShadowMaterial.dispose();
      container.replaceChildren();
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
  scene.background = new three.Color(0xf8f4ed);

  const camera = new three.PerspectiveCamera(48, 1, 0.1, 140);
  const topCamera = new three.PerspectiveCamera(48, 1, 0.1, 140);
  topCamera.up.set(0, 0, -1);
  topCamera.position.set(0, 16.5, 0.01);
  topCamera.lookAt(0, 0, 0);
  const sideCamera = new three.PerspectiveCamera(44, 1, 0.1, 140);
  sideCamera.up.set(0, 1, 0);
  sideCamera.position.set(0, 18, 25);
  sideCamera.lookAt(0, 0, 0);
  const topRotation = topCamera.quaternion.clone();
  const sideRotation = sideCamera.quaternion.clone();
  const topPosition = new three.Vector3(0, 16.5, 0.01);
  const sidePosition = new three.Vector3(0, 18, 25);
  const nextCameraPosition = new three.Vector3();

  const webglRenderer = new three.WebGLRenderer({
    alpha: false,
    antialias: true,
    powerPreference: "low-power",
    stencil: false,
  });
  webglRenderer.setClearColor(0xf8f4ed, 1);
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

  const floorTexture = createFloorTexture(three, 0.68);
  const floorMaterial = new three.MeshBasicMaterial({ map: floorTexture, toneMapped: false });
  const floor = new three.Mesh(createLandingCycloramaGeometry(three), floorMaterial);
  floor.position.y = -0.17;
  scene.add(floor);

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
        createRealLaptop(three, CSS3DObject, screenHost, laptopSource, spec.viewportWidth, spec.viewportHeight),
      );
    }

    handset.updateMatrixWorld(true);
    const boundsAtUnitScale = new three.Box3().setFromObject(handset);
    const floorOffset = boundsAtUnitScale.min.y;
    handset.position.set(spec.x, floor.position.y - floorOffset * spec.scale, spec.z);
    handset.scale.setScalar(spec.scale);
    handset.updateMatrixWorld(true);

    const shadowResource = getShadowResource(spec.kind);
    const shadow = new three.Mesh(shadowResource.soft.geometry, shadowResource.soft.material);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(spec.x + 0.22, floor.position.y + 0.003, spec.z + 0.35);
    shadow.scale.setScalar(spec.scale);
    shadow.renderOrder = 2;
    const contactShadow = new three.Mesh(shadowResource.contact.geometry, shadowResource.contact.material);
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.set(spec.x + 0.08, floor.position.y + 0.004, spec.z + 0.12);
    contactShadow.scale.setScalar(spec.scale);
    contactShadow.renderOrder = 3;
    scene.add(handset, shadow, contactShadow);
    return [{ handset, shadow, contactShadow, spec, floorOffset }];
  });

  container.append(webglRenderer.domElement, cssRenderer.domElement);

  let width = 0;
  let height = 0;
  let pixelRatio = 0;
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
    render();
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

  const setProgress = (progress: number) => {
    const expanded = smoothstep(0.14, 0.5, progress);
    const leaving = smoothstep(0.8, 0.97, progress);
    const sideAmount = expanded * (1 - leaving);
    camera.position.copy(nextCameraPosition.lerpVectors(topPosition, sidePosition, sideAmount));
    camera.quaternion.slerpQuaternions(topRotation, sideRotation, sideAmount);
    camera.fov = 48 - 4 * sideAmount;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    const compactLayout = width <= 720;
    const horizontalScale = compactLayout ? 0.52 : 1;
    const depthScale = compactLayout ? 0.62 : 1;
    const exitSpread = compactLayout ? 9 : 15;

    devices.forEach(({ handset, shadow, contactShadow, spec, floorOffset }) => {
      const exitDirection = new three.Vector2(spec.x, spec.z).normalize();
      const x = spec.x * horizontalScale * expanded + exitDirection.x * exitSpread * leaving;
      const z = spec.z * depthScale * expanded + exitDirection.y * exitSpread * leaving;
      const scale = spec.scale * expanded * (1 - leaving);
      handset.position.set(x, floor.position.y - floorOffset * scale, z);
      handset.scale.setScalar(scale);
      handset.visible = scale > 0.001;
      handset.rotation.set(0, 0, 0);
      handset.rotateOnWorldAxis(floorNormalAxis, spec.yaw * expanded * (1 - leaving));
      shadow.position.set(x + 0.25, floor.position.y + 0.004, z + 0.45);
      shadow.scale.setScalar(scale);
      shadow.visible = scale > 0.001;
      contactShadow.position.set(x + 0.08, floor.position.y + 0.005, z + 0.12);
      contactShadow.scale.setScalar(scale);
      contactShadow.visible = scale > 0.001;
    });
    render();
  };

  return {
    setProgress,
    cleanup: () => {
      resizeObserver.disconnect();
      webglRenderer.dispose();
      floorTexture.dispose();
      textures.forEach((texture) => texture.dispose());
      environmentTexture?.dispose();
      floor.geometry.dispose();
      floorMaterial.dispose();
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      container.replaceChildren();
    },
  };
}

function smoothstep(minimum: number, maximum: number, value: number) {
  const amount = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  return amount * amount * (3 - 2 * amount);
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

function createLandingCycloramaGeometry(three: ThreeRuntime) {
  const floorLevel = 0;
  const floorFrontZ = 80;
  const floorBackZ = -26;
  const curveRadius = 14;
  const curveSegments = 24;
  const wallHeight = 120;
  const xExtent = 80;
  const xSegments = 40;
  const profile: Array<{ y: number; z: number; distance: number }> = [];
  let distance = 0;
  const addProfilePoint = (y: number, z: number) => {
    const previous = profile.at(-1);
    if (previous) distance += Math.hypot(y - previous.y, z - previous.z);
    profile.push({ y, z, distance });
  };

  addProfilePoint(floorLevel, floorFrontZ);
  addProfilePoint(floorLevel, floorBackZ);
  for (let segment = 1; segment <= curveSegments; segment += 1) {
    const angle = (segment / curveSegments) * (Math.PI / 2);
    addProfilePoint(floorLevel + curveRadius * (1 - Math.cos(angle)), floorBackZ - curveRadius * Math.sin(angle));
  }
  addProfilePoint(wallHeight, floorBackZ - curveRadius);

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let xSegment = 0; xSegment <= xSegments; xSegment += 1) {
    const x = -xExtent + ((xExtent * 2) / xSegments) * xSegment;
    for (const point of profile) {
      positions.push(x, point.y, point.z);
      uvs.push((x + xExtent) / 120, point.distance / 120);
    }
  }

  const profileCount = profile.length;
  for (let xSegment = 0; xSegment < xSegments; xSegment += 1) {
    for (let profileIndex = 0; profileIndex < profileCount - 1; profileIndex += 1) {
      const current = xSegment * profileCount + profileIndex;
      const nextX = current + profileCount;
      indices.push(current, nextX, current + 1, current + 1, nextX, nextX + 1);
    }
  }

  const geometry = new three.BufferGeometry();
  geometry.setAttribute("position", new three.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new three.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createFloorTexture(three: ThreeRuntime, gridStrength = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#f8f4ed";
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let offset = 0; offset <= 256; offset += 64) {
      const isMajorGridLine = offset % 128 === 0;
      const majorGridOpacity = 0.15 * gridStrength;
      const minorGridOpacity = 0.09 * gridStrength;
      context.strokeStyle = isMajorGridLine
        ? `rgba(39, 48, 57, ${majorGridOpacity})`
        : `rgba(39, 48, 57, ${minorGridOpacity})`;
      context.lineWidth = isMajorGridLine ? 1.5 : 1;
      context.beginPath();
      context.moveTo(offset + 0.5, 0);
      context.lineTo(offset + 0.5, 256);
      context.stroke();
      context.beginPath();
      context.moveTo(0, offset + 0.5);
      context.lineTo(256, offset + 0.5);
      context.stroke();
    }
    for (let x = 0; x <= 256; x += 64) {
      for (let y = 0; y <= 256; y += 64) {
        const isMajorIntersection = x % 128 === 0 && y % 128 === 0;
        const majorIntersectionOpacity = 0.25 * gridStrength;
        const minorIntersectionOpacity = 0.14 * gridStrength;
        context.fillStyle = isMajorIntersection
          ? `rgba(200, 135, 23, ${majorIntersectionOpacity})`
          : `rgba(200, 135, 23, ${minorIntersectionOpacity})`;
        context.beginPath();
        context.arc(x, y, isMajorIntersection ? 1.8 : 1.2, 0, Math.PI * 2);
        context.fill();
      }
    }
  }

  const texture = new three.CanvasTexture(canvas);
  texture.colorSpace = three.SRGBColorSpace;
  texture.wrapS = three.RepeatWrapping;
  texture.wrapT = three.RepeatWrapping;
  texture.repeat.set(45, 45);
  texture.anisotropy = 4;
  return texture;
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
