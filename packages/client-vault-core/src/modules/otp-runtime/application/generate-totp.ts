import type { TotpConfiguration } from "../domain/totp-configuration";

export interface HmacGenerator {
  sign(algorithm: TotpConfiguration["algorithm"], secret: Uint8Array, message: Uint8Array): Promise<Uint8Array>;
}

export type TotpCode = { value: string; validUntil: Date };

export async function generateTotp(
  configuration: TotpConfiguration,
  hmac: HmacGenerator,
  now = new Date(),
): Promise<TotpCode> {
  const milliseconds = now.getTime();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new Error("A valid time is required.");
  const periodMilliseconds = configuration.period * 1_000;
  const counter = BigInt(Math.floor(milliseconds / periodMilliseconds));
  const digest = await hmac.sign(configuration.algorithm, configuration.secret, encodeCounter(counter));
  if (digest.length < 20) throw new Error("The HMAC digest is too short.");
  const offset = digest[digest.length - 1] & 0x0f;
  if (offset + 4 > digest.length) throw new Error("The HMAC digest has an invalid offset.");
  const binary =
    ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  const modulus = 10 ** configuration.digits;
  return {
    value: String(binary % modulus).padStart(configuration.digits, "0"),
    validUntil: new Date((Number(counter) + 1) * periodMilliseconds),
  };
}

function encodeCounter(counter: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = Number((counter >> BigInt((7 - index) * 8)) & 0xffn);
  }
  return bytes;
}
