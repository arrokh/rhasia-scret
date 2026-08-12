/** Public synthetic vectors only; none is production account or user key material. */
export const ARGON2ID_PROTOCOL_VECTOR = {
  secret: "platform portability vector",
  salt: Uint8Array.from({ length: 16 }, (_, index) => index),
  memoryKiB: 64 * 1024,
  iterations: 3,
  parallelism: 1,
  outputBytes: 32,
  expectedHex: "6562731dde64f1563378dc4609d8eaba0361a655ff24e2739dd89ae592a077c5"
} as const;

export const RFC6238_SHA1_VECTOR = {
  secret: Uint8Array.of(49, 50, 51, 52, 53, 54, 55, 56, 57, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 48),
  timestampMilliseconds: 59_000,
  algorithm: "SHA-1" as const,
  digits: 8 as const,
  period: 30,
  expectedCode: "94287082"
} as const;
