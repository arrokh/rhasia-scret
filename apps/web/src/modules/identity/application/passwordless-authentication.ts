import { deliverMagicLinkEmail, type MagicLinkEmailSender } from "./email-delivery";
import type { SessionAssurance, VerifiedPrincipal } from "./session-verifier";

export const PASSWORDLESS_ISSUER = "rhasia:passwordless";
export type PasswordlessClient = "web" | "mobile" | "pwa";
export type PasswordlessReturnPath = "/vaults" | "/vaults/invitations/redeem";

export function isSafePwaHandoffId(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

export function isSafePwaHandoffVerifier(value: string): boolean {
  return /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

export type MagicLinkChallenge = Readonly<{
  email: string;
  client: PasswordlessClient;
  returnPath: PasswordlessReturnPath;
}>;

export type PasswordlessSession = Readonly<{
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  principal: VerifiedPrincipal;
}>;

export type PasswordlessAccount = Readonly<{
  applicationUserId: string;
  issuer: string;
  subject: string;
  email: string;
}>;

export interface PasswordlessAuthRepository {
  createChallenge(
    input: Readonly<{
      tokenDigest: Uint8Array;
      challenge: MagicLinkChallenge;
      expiresAt: Date;
      pwaHandoff?: Readonly<{
        handoffIdDigest: Uint8Array;
        verifierDigest: Uint8Array;
        expiresAt: Date;
      }>;
    }>,
  ): Promise<void>;
  consumeChallenge(tokenDigest: Uint8Array, client: PasswordlessClient, now: Date): Promise<MagicLinkChallenge | null>;
  findOrCreateAccount(email: string, now: Date): Promise<PasswordlessAccount>;
  createSession(account: PasswordlessAccount, now: Date): Promise<PasswordlessSession>;
  verifyAccessToken(tokenDigest: Uint8Array, now: Date): Promise<VerifiedPrincipal | null>;
  verifyBrowserSession(sessionId: string, now: Date): Promise<VerifiedPrincipal | null>;
  rotateRefreshToken(tokenDigest: Uint8Array, sessionId: string, now: Date): Promise<PasswordlessSession | null>;
  revokeSession(sessionId: string, now: Date, reason?: string): Promise<void>;
  publishPwaHandoff(
    tokenDigest: Uint8Array,
    sessionId: string,
    handoffIdDigest: Uint8Array,
    now: Date,
  ): Promise<boolean>;
  redeemPwaHandoff(
    handoffIdDigest: Uint8Array,
    verifierDigest: Uint8Array,
    now: Date,
  ): Promise<Readonly<{ session: PasswordlessSession; returnPath: PasswordlessReturnPath }> | null>;
}

export interface PasswordlessAuthService {
  requestLink(
    input: Readonly<{
      email: string;
      client: PasswordlessClient;
      returnPath: PasswordlessReturnPath;
      handoffId?: string;
      handoffVerifier?: string;
    }>,
  ): Promise<void>;
  redeem(
    token: string,
    client: PasswordlessClient,
  ): Promise<Readonly<{ session: PasswordlessSession; returnPath: PasswordlessReturnPath }> | null>;
  verifyAccessToken(token: string): Promise<VerifiedPrincipal | null>;
  verifyBrowserSession(sessionId: string): Promise<VerifiedPrincipal | null>;
  refresh(refreshToken: string): Promise<PasswordlessSession | null>;
  revoke(sessionId: string, reason?: string): Promise<void>;
  publishPwaHandoff(refreshToken: string, handoffId: string): Promise<void>;
  redeemPwaHandoff(
    handoffId: string,
    verifier: string,
  ): Promise<Readonly<{ session: PasswordlessSession; returnPath: PasswordlessReturnPath }> | null>;
}

export type PasswordlessAuthDependencies = Readonly<{
  repository: PasswordlessAuthRepository;
  sender: MagicLinkEmailSender;
  generateToken(): Readonly<{ rawToken: string; digest: Uint8Array }>;
  digestToken(token: string): Uint8Array;
  buildActionUrl(
    client: PasswordlessClient,
    rawToken: string,
    returnPath: PasswordlessReturnPath,
    handoffId?: string,
  ): URL;
  magicLinkTtlSeconds: number;
  now?: () => Date;
}>;

export function createPasswordlessAuthService(dependencies: PasswordlessAuthDependencies): PasswordlessAuthService {
  const now = dependencies.now ?? (() => new Date());

  return {
    async requestLink(
      input: Readonly<{
        email: string;
        client: PasswordlessClient;
        returnPath: PasswordlessReturnPath;
        handoffId?: string;
        handoffVerifier?: string;
      }>,
    ) {
      const email = normalizeEmail(input.email);
      if (!isEmail(email)) throw new Error("Email address is invalid.");
      if (
        input.client === "pwa" &&
        (!input.handoffId ||
          !isSafePwaHandoffId(input.handoffId) ||
          !input.handoffVerifier ||
          !isSafePwaHandoffVerifier(input.handoffVerifier))
      )
        throw new Error("PWA authentication handoff is invalid.");
      if (input.client !== "pwa" && (input.handoffId !== undefined || input.handoffVerifier !== undefined))
        throw new Error("PWA authentication handoff is invalid.");
      const generated = dependencies.generateToken();
      const requestedAt = now();
      const expiresAt = new Date(requestedAt.getTime() + dependencies.magicLinkTtlSeconds * 1_000);
      await dependencies.repository.createChallenge({
        tokenDigest: generated.digest,
        challenge: { email, client: input.client, returnPath: input.returnPath },
        expiresAt,
        ...(input.client === "pwa"
          ? {
              pwaHandoff: {
                handoffIdDigest: dependencies.digestToken(input.handoffId as string),
                verifierDigest: dependencies.digestToken(input.handoffVerifier as string),
                expiresAt,
              },
            }
          : {}),
      });
      const actionUrl =
        input.handoffId === undefined
          ? dependencies.buildActionUrl(input.client, generated.rawToken, input.returnPath)
          : dependencies.buildActionUrl(input.client, generated.rawToken, input.returnPath, input.handoffId);
      await deliverMagicLinkEmail({ recipientEmail: email, actionUrl }, dependencies.sender);
    },

    async redeem(
      token: string,
      client: PasswordlessClient,
    ): Promise<Readonly<{ session: PasswordlessSession; returnPath: PasswordlessReturnPath }> | null> {
      if (!isMagicLinkToken(token)) return null;
      const consumed = await dependencies.repository.consumeChallenge(dependencies.digestToken(token), client, now());
      if (!consumed) return null;
      const account = await dependencies.repository.findOrCreateAccount(consumed.email, now());
      const session = await dependencies.repository.createSession(account, now());
      return { session, returnPath: consumed.returnPath };
    },

    async verifyAccessToken(token: string): Promise<VerifiedPrincipal | null> {
      if (!isSessionToken(token)) return null;
      return dependencies.repository.verifyAccessToken(dependencies.digestToken(token), now());
    },

    async verifyBrowserSession(sessionId: string): Promise<VerifiedPrincipal | null> {
      if (!isSafeSessionId(sessionId)) return null;
      return dependencies.repository.verifyBrowserSession(sessionId, now());
    },

    async refresh(refreshToken: string): Promise<PasswordlessSession | null> {
      if (!isSessionToken(refreshToken)) return null;
      const sessionId = sessionIdFromCredential(refreshToken);
      if (!sessionId) return null;
      return dependencies.repository.rotateRefreshToken(dependencies.digestToken(refreshToken), sessionId, now());
    },

    async revoke(sessionId: string, reason = "logout"): Promise<void> {
      if (!isSafeSessionId(sessionId)) return;
      await dependencies.repository.revokeSession(sessionId, now(), reason);
    },

    async publishPwaHandoff(refreshToken: string, handoffId: string): Promise<void> {
      if (!isSessionToken(refreshToken) || !isSafePwaHandoffId(handoffId))
        throw new Error("PWA authentication handoff is invalid.");
      const sessionId = sessionIdFromCredential(refreshToken);
      if (
        !sessionId ||
        !(await dependencies.repository.publishPwaHandoff(
          dependencies.digestToken(refreshToken),
          sessionId,
          dependencies.digestToken(handoffId),
          now(),
        ))
      )
        throw new Error("PWA authentication handoff is invalid.");
    },

    async redeemPwaHandoff(handoffId: string, verifier: string) {
      if (!isSafePwaHandoffId(handoffId) || !isSafePwaHandoffVerifier(verifier)) return null;
      return dependencies.repository.redeemPwaHandoff(
        dependencies.digestToken(handoffId),
        dependencies.digestToken(verifier),
        now(),
      );
    },
  };
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isMagicLinkToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

export function isSessionToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}\.[A-Za-z0-9_-]{43,128}$/.test(value);
}

export function isSafeSessionId(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

function sessionIdFromCredential(credential: string): string | null {
  const sessionId = credential.split(".", 1)[0];
  return isSafeSessionId(sessionId) ? sessionId : null;
}

export function passwordlessPrincipal(account: PasswordlessAccount, assurance: SessionAssurance): VerifiedPrincipal {
  return {
    issuer: account.issuer,
    subject: account.subject,
    email: account.email,
    emailVerified: true,
    assurance,
    sessionId: undefined,
  };
}
