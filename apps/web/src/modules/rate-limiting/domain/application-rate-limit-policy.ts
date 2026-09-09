export const APPLICATION_RATE_LIMIT_POLICIES = {
  account_mutation: { limit: 120, windowSeconds: 60 },
  archive_export: { limit: 10, windowSeconds: 3_600 },
  archive_import: { limit: 10, windowSeconds: 3_600 },
  audit_event: { limit: 120, windowSeconds: 60 },
  destructive_mutation: { limit: 5, windowSeconds: 3_600 },
  key_material_mutation: { limit: 10, windowSeconds: 300 },
  membership_mutation: { limit: 30, windowSeconds: 60 },
  recovery_authentication: { limit: 30, windowSeconds: 300 },
  recovery_mutation: { limit: 10, windowSeconds: 600 },
  vault_mutation: { limit: 30, windowSeconds: 60 },
} as const;

export type ApplicationRateLimitPolicyId = keyof typeof APPLICATION_RATE_LIMIT_POLICIES;
export type ApplicationRateLimitPolicy = Readonly<{ limit: number; windowSeconds: number }>;
