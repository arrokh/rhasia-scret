export type PasskeyRecoveryConfiguration = { rpId: string; origin: string; rpName: string };

export function passkeyRecoveryConfiguration(): PasskeyRecoveryConfiguration {
  const rpId = process.env.PASSKEY_RP_ID;
  const origin = process.env.PASSKEY_ORIGIN;
  if (!rpId || !origin) throw new Error("Passkey recovery is not configured.");
  return { rpId, origin, rpName: "Brankas TOTP Bersama" };
}
