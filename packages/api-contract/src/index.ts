import { z } from "zod";

export * from "./paths";
export * from "./generated-routes";

/** Errors are locale-independent transport values; presentation owns translation. */
export const apiErrorSchema = z
  .object({
    error: z.string().min(1),
  })
  .passthrough();

export type ApiError = z.infer<typeof apiErrorSchema>;

export const healthResponseSchema = z.object({ status: z.literal("ok") });
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const timeResponseSchema = z.object({ now: z.iso.datetime() });
export type TimeResponse = z.infer<typeof timeResponseSchema>;
