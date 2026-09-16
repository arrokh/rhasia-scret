import { hmacSha256, randomBase64Url } from "@api/shared/infrastructure/crypto";

export type PasswordlessTokenGenerator = Readonly<{
  generate(): Readonly<{ rawToken: string; digest: Uint8Array }>;
  digest(token: string): Uint8Array;
}>;

export function createPasswordlessTokenGenerator(secret: Uint8Array): PasswordlessTokenGenerator {
  return {
    generate() {
      const rawToken = randomBase64Url(32);
      return { rawToken, digest: digestPasswordlessToken(secret, rawToken) };
    },
    digest(token) {
      return digestPasswordlessToken(secret, token);
    },
  };
}

export function createSessionCredential(sessionId: string): string {
  return `${sessionId}.${randomBase64Url(32)}`;
}

export function digestPasswordlessToken(secret: Uint8Array, token: string): Uint8Array {
  return hmacSha256(secret, token);
}
