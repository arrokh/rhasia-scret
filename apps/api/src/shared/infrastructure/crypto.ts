import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function randomBase64Url(length: number): string {
  return toBase64Url(randomBytes(length));
}

export function randomInt(minimum: number, maximumExclusive: number): number {
  if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximumExclusive) || maximumExclusive <= minimum)
    throw new Error("Invalid random integer range.");
  const range = maximumExclusive - minimum;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  const values = new Uint32Array(1);
  do crypto.getRandomValues(values);
  while (values[0] >= limit);
  return minimum + (values[0] % range);
}

export function randomUuidWithoutDashes(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function hmacSha256(secret: Uint8Array, ...parts: string[]): Uint8Array {
  const message = new TextEncoder().encode(parts.join(""));
  return hmac(sha256, secret, message);
}

export function sha256Digest(value: Uint8Array | string): Uint8Array {
  return sha256(typeof value === "string" ? new TextEncoder().encode(value) : value);
}

export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
