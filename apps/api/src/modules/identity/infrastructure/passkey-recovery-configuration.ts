export type PasskeyRecoveryConfiguration = { rpId: string; origin: string; rpName: string };

export function passkeyRecoveryConfiguration(
  bindings: Readonly<{ PASSKEY_RP_ID?: string; PASSKEY_ORIGIN?: string }>,
): PasskeyRecoveryConfiguration {
  const rpId = bindings.PASSKEY_RP_ID;
  const origin = bindings.PASSKEY_ORIGIN;
  if (!rpId || !origin) throw new Error("Passkey recovery is not configured.");
  return { rpId, origin, rpName: "rhasia-scret" };
}
