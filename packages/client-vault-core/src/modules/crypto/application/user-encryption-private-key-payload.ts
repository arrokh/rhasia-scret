import type { PortableJsonWebKey } from "./crypto-ports";
export function clearPrivateJwk(privateKey: PortableJsonWebKey): void {
  clearPrivateJwkCandidate(privateKey);
}

export function clearPrivateJwkCandidate(value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return;
  for (const field of ["x", "y", "d"] as const) {
    if (typeof Reflect.get(value, field) === "string") Reflect.set(value, field, "");
  }
}

export function isUserEncryptionPrivateKey(value: unknown): value is PortableJsonWebKey {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).kty === "EC" &&
    (value as Record<string, unknown>).crv === "P-256" &&
    typeof (value as Record<string, unknown>).x === "string" &&
    typeof (value as Record<string, unknown>).y === "string" &&
    typeof (value as Record<string, unknown>).d === "string"
  );
}
