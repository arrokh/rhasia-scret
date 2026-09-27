import { z } from "zod";

export const publicEncryptionKeySchema = z
  .object({
    kty: z.literal("EC"),
    crv: z.literal("P-256"),
    x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    y: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    ext: z.boolean().optional(),
    key_ops: z.array(z.string()).max(8).optional(),
  })
  .strict();

export type PublicEncryptionKey = z.infer<typeof publicEncryptionKeySchema>;
