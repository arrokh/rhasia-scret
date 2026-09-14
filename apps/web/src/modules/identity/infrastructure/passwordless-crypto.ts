import { createHmac, randomBytes } from "node:crypto";

export type PasswordlessTokenGenerator = Readonly<{
  generate(): Readonly<{ rawToken: string; digest: Uint8Array }>;
  digest(token: string): Uint8Array;
}>;

export function createPasswordlessTokenGenerator(secret: Uint8Array): PasswordlessTokenGenerator {
  return {
    generate() {
      const rawToken = randomBytes(32).toString("base64url");
      return { rawToken, digest: digestPasswordlessToken(secret, rawToken) };
    },
    digest(token) {
      return digestPasswordlessToken(secret, token);
    },
  };
}

export function createSessionCredential(sessionId: string): string {
  return `${sessionId}.${randomBytes(32).toString("base64url")}`;
}

export function digestPasswordlessToken(secret: Uint8Array, token: string): Uint8Array {
  return new Uint8Array(createHmac("sha256", secret).update(token, "utf8").digest());
}
