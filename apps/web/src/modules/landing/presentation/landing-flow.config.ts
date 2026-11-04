import { z } from "zod";
import configJson from "./landing-flow.config.json";

const landingSceneSteps = [
  "locked",
  "unlocking",
  "unlocked",
  "expanding",
  "contracting",
  "devices",
  "leaving",
  "returning",
  "settled",
] as const;
const landingPhoneViews = [
  "accounts",
  "scan",
  "review",
  "added",
  "sharedCreate",
  "sharedInvite",
  "sharedPermissions",
  "sharedReady",
] as const;
const landingSceneStepSchema = z.enum(landingSceneSteps);
const landingPhoneViewSchema = z.enum(landingPhoneViews);
const landingShowcaseDeviceSchema = z.object({
  kind: z.enum(["tablet", "laptop"]),
  view: landingPhoneViewSchema,
  accountCount: z.number().int().positive(),
  viewportWidth: z.number().positive(),
  viewportHeight: z.number().positive(),
  x: z.number(),
  z: z.number(),
  scale: z.number().positive(),
  yaw: z.number(),
});

const landingFlowConfigSchema = z.object({
  version: z.literal(1),
  intro: z.object({
    initialState: landingSceneStepSchema,
    states: z
      .array(
        z.object({
          id: landingSceneStepSchema,
          screen: z.string(),
          passphraseEmpty: z.boolean().optional(),
          scrollHint: z.enum(["top", "hero"]).optional(),
          process: z.string().optional(),
          processingIndicator: z.boolean().optional(),
          sampleAccountCount: z.number().int().nonnegative().optional(),
          syntheticData: z.boolean().optional(),
          clock: z.string().optional(),
          heroCard: z.boolean().optional(),
          journeyStartGuide: z.boolean().optional(),
        }),
      )
      .min(1),
    transitions: z.array(
      z.object({
        from: landingSceneStepSchema,
        trigger: z.string(),
        to: landingSceneStepSchema,
      }),
    ),
    processingStates: z.array(landingSceneStepSchema),
    input: z.object({
      mode: z.string(),
      ignoreDuringProcessing: z.boolean(),
      forwardKeys: z.array(z.string()),
      backwardKeys: z.array(z.string()),
      touchThresholdPx: z.number().nonnegative(),
      wheelGestureReleaseMs: z.number().nonnegative(),
    }),
    durationsMs: z.object({
      showcaseExpansion: z.number().nonnegative(),
      deviceTransition: z.number().nonnegative(),
      deviceDepartureDelay: z.number().nonnegative(),
    }),
    unlockDemo: z.object({
      maskedPassphraseLength: z.number().int().positive(),
      cursorTravel: z.number().nonnegative(),
      characterInterval: z.number().nonnegative(),
      buttonPress: z.number().nonnegative(),
      clickFeedback: z.number().nonnegative(),
      startDelay: z.number().nonnegative(),
      preUnlockPause: z.number().nonnegative(),
    }),
  }),
  showcase: z.object({
    phoneModelId: z.string().min(1),
    modelPaths: z.object({
      iphone: z.string().startsWith("/models/"),
      macbook: z.string().startsWith("/models/"),
    }),
    devices: z.array(landingShowcaseDeviceSchema),
  }),
  journey: z.object({
    mode: z.string(),
    activeStepSelection: z.string(),
    steps: z
      .array(
        z.object({
          id: landingPhoneViewSchema,
          phoneView: landingPhoneViewSchema,
        }),
      )
      .min(1),
    afterJourney: z.array(z.enum(["final-cta", "footer"])),
  }),
});

export const landingFlowConfig = landingFlowConfigSchema.parse(configJson);

export type LandingSceneStep = z.infer<typeof landingSceneStepSchema>;
export type LandingPhoneView = z.infer<typeof landingPhoneViewSchema>;
export type LandingDeviceKind = "phone" | "tablet" | "laptop";
export type LandingShowcaseDevice = z.infer<typeof landingShowcaseDeviceSchema>;
