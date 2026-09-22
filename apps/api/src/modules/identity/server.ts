import type { ApiBindings, ApiConfigBindings } from "@api/types";
import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";
import { loadApplicationUser } from "./application/load-application-user";
import {
  ApplicationUserCredentialInvalidatedError,
  type ApplicationUserRepository,
} from "./application/application-user-repository";
import type { SessionVerifier } from "./application/session-verifier";
import type { SessionTerminator } from "./application/session-terminator";
import type { UserCryptoProfileRepository } from "./application/user-crypto-profile-repository";
import type { PasswordlessAuthService } from "./application/passwordless-authentication";
import type { IdentityRuntime } from "./application/identity-runtime";
import type { MagicLinkEmailSender } from "./application/email-delivery";
import { AUTH_RETURN_PATH_COOKIE } from "./application/auth-return-path";
import { PrismaApplicationUserRepository } from "./infrastructure/prisma-application-user-repository";
import { PrismaPasskeyRecoveryRepository } from "./infrastructure/prisma-passkey-recovery-repository";
import { PrismaUserCryptoProfileRepository } from "./infrastructure/prisma-user-crypto-profile-repository";
import { isOidcPrincipalAdmitted } from "./infrastructure/prisma-application-admission";
import { PasswordlessSessionTerminator } from "./infrastructure/passwordless-session-terminator";
import { PasswordlessSessionVerifier } from "./infrastructure/passwordless-session-verifier";
import { OidcSessionVerifier } from "./infrastructure/oidc-session-verifier";
import { OidcSessionTerminator } from "./infrastructure/oidc-session-terminator";
import {
  createPasswordlessAuthServiceForApi,
  isPasswordlessClient,
  isPasswordlessReturnPath,
  isSafePwaHandoffId,
  isSafePwaHandoffVerifier,
  readApiPasswordlessConfiguration,
} from "./infrastructure/passwordless-service";
import { PrismaAnonymousAuthRateLimiter } from "./infrastructure/prisma-anonymous-auth-rate-limiter";
import {
  CloudflareTurnstileValidator,
  isSafeTurnstileToken,
  type TurnstileUnavailableReason,
  type TurnstileValidationDiagnostics,
  type TurnstileValidationResult,
} from "./infrastructure/turnstile";
import {
  isClientOriginAllowed,
  isSameOrigin,
  isSameOriginIfPresent,
  requestClientIp,
  requestPublicOrigin,
} from "./infrastructure/request-origin";
import {
  clearPasswordlessSessionCookies,
  PASSWORDLESS_REFRESH_COOKIE,
  setPasswordlessSessionCookies,
} from "./infrastructure/passwordless-session";
import { assuranceSatisfies, type SessionAssurance, type VerifiedPrincipal } from "./application/session-verifier";
import { passkeyRecoveryConfiguration } from "./infrastructure/passkey-recovery-configuration";
import { clearE2eSessionCookie, createE2eSessionVerifier } from "./infrastructure/e2e-session-verifier";
import {
  browserE2eAuthenticationVerified,
  browserE2eRegistrationCredential,
  browserE2eTestsEnabled,
} from "./infrastructure/e2e-passkey-verification";
import { AuthenticationConfigurationError, type AuthConfigurationField } from "./infrastructure/auth-backend";

export {
  loadApplicationUser,
  ApplicationUserCredentialInvalidatedError,
  AuthenticationConfigurationError,
  AUTH_RETURN_PATH_COOKIE,
  isPasswordlessClient,
  isPasswordlessReturnPath,
  isSafePwaHandoffId,
  isSafePwaHandoffVerifier,
  isSafeTurnstileToken,
  isClientOriginAllowed,
  isSameOrigin,
  isSameOriginIfPresent,
  requestClientIp,
  requestPublicOrigin,
  clearPasswordlessSessionCookies,
  PASSWORDLESS_REFRESH_COOKIE,
  setPasswordlessSessionCookies,
  passkeyRecoveryConfiguration,
  clearE2eSessionCookie,
  browserE2eAuthenticationVerified,
  browserE2eRegistrationCredential,
  browserE2eTestsEnabled,
};
export type {
  ApplicationUserRepository,
  SessionVerifier,
  UserCryptoProfileRepository,
  TurnstileUnavailableReason,
  TurnstileValidationDiagnostics,
  TurnstileValidationResult,
};
export type { PasswordlessAuthService };
export type { IdentityRuntime };

export function authBackend(
  bindings: Pick<ApiBindings, "AUTH_BACKEND"> & Partial<Pick<ApiBindings, "NODE_ENV">>,
): "none" | "passwordless" | "oidc" {
  const configuredBackend = bindings.AUTH_BACKEND?.trim();
  if (!configuredBackend && bindings.NODE_ENV === "production")
    throw new AuthenticationConfigurationError("AUTH_BACKEND", "AUTH_BACKEND must be set explicitly in production.");
  const backend = configuredBackend || "passwordless";
  if (backend === "none" || backend === "passwordless" || backend === "oidc") return backend;
  throw new AuthenticationConfigurationError("AUTH_BACKEND", "AUTH_BACKEND must be none, passwordless, or oidc.");
}

export function readPasswordlessConfiguration(bindings: ApiConfigBindings) {
  return readApiPasswordlessConfiguration(bindings);
}

export function validateAuthenticationConfiguration(bindings: ApiConfigBindings): void {
  const backend = authBackend(bindings);
  if (backend === "passwordless") {
    readPasswordlessConfiguration(bindings);
    return;
  }
  if (backend !== "oidc") return;
  requiredUrl(bindings.OIDC_ISSUER, "OIDC_ISSUER", bindings.NODE_ENV);
  required(bindings.OIDC_CLIENT_ID, "OIDC_CLIENT_ID");
  const sessionSecret = required(bindings.OIDC_SESSION_SECRET, "OIDC_SESSION_SECRET");
  if (sessionSecret.length < 32)
    throw new AuthenticationConfigurationError(
      "OIDC_SESSION_SECRET",
      "OIDC_SESSION_SECRET must contain at least 32 characters.",
    );
}

export function createPasswordlessAuthService(
  database: PrismaDatabase,
  bindings: ApiBindings,
  sender: MagicLinkEmailSender,
): PasswordlessAuthService {
  return createPasswordlessAuthServiceForApi(database, bindings, sender);
}

export function createPasswordlessAuthServiceForRuntime(
  database: PrismaDatabase,
  bindings: ApiBindings,
  sender: MagicLinkEmailSender,
): PasswordlessAuthService {
  if (authBackend(bindings) === "passwordless") return createPasswordlessAuthService(database, bindings, sender);
  return disabledPasswordlessAuthService();
}

export function createIdentityRuntime(
  database: PrismaDatabase,
  bindings: ApiBindings,
  sender: MagicLinkEmailSender,
): IdentityRuntime {
  const passwordlessAuth = createPasswordlessAuthServiceForRuntime(database, bindings, sender);
  return {
    passwordlessAuth,
    sessionVerifier: createSessionVerifier(database, bindings, sender, passwordlessAuth),
    sessionTerminator: createSessionTerminator(database, bindings, sender, passwordlessAuth),
    applicationUsers: createApplicationUserRepository(database, bindings),
    userCryptoProfiles: createUserCryptoProfileRepository(database),
  };
}

export function createAnonymousAuthRateLimiter(
  database: PrismaDatabase,
  bindings: ApiBindings,
): PrismaAnonymousAuthRateLimiter {
  const secret = bindings.AUTH_MAGIC_LINK_SECRET;
  if (!secret) throw new Error("AUTH_MAGIC_LINK_SECRET is required.");
  return new PrismaAnonymousAuthRateLimiter(database, new TextEncoder().encode(secret));
}

export function createTurnstileValidator(
  bindings: Pick<ApiBindings, "TURNSTILE_SECRET_KEY">,
): CloudflareTurnstileValidator {
  const secret = bindings.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) throw new Error("TURNSTILE_SECRET_KEY is required.");
  return new CloudflareTurnstileValidator(secret);
}

export function createSessionVerifier(
  database: PrismaDatabase,
  bindings: ApiBindings,
  sender: MagicLinkEmailSender,
  passwordlessAuth?: PasswordlessAuthService,
): SessionVerifier {
  const e2eVerifier = createE2eSessionVerifier(bindings);
  if (e2eVerifier) return e2eVerifier;
  const backend = authBackend(bindings);
  if (backend === "none") return { verify: async (_request: Request, _minimum?: SessionAssurance) => null };
  if (backend === "passwordless") {
    return new PasswordlessSessionVerifier(
      passwordlessAuth ?? createPasswordlessAuthService(database, bindings, sender),
      readPasswordlessConfiguration(bindings),
    );
  }
  const issuer = requiredUrl(bindings.OIDC_ISSUER, "OIDC_ISSUER", bindings.NODE_ENV);
  const clientId = required(bindings.OIDC_CLIENT_ID, "OIDC_CLIENT_ID");
  const sessionSecret = required(bindings.OIDC_SESSION_SECRET, "OIDC_SESSION_SECRET");
  if (sessionSecret.length < 32)
    throw new AuthenticationConfigurationError(
      "OIDC_SESSION_SECRET",
      "OIDC_SESSION_SECRET must contain at least 32 characters.",
    );
  return new OidcSessionVerifier({ issuer, clientId, sessionSecret: new TextEncoder().encode(sessionSecret) });
}

export function createSessionTerminator(
  database: PrismaDatabase,
  bindings: ApiBindings,
  sender: MagicLinkEmailSender,
  passwordlessAuth?: PasswordlessAuthService,
): SessionTerminator {
  return authBackend(bindings) === "passwordless"
    ? new PasswordlessSessionTerminator(passwordlessAuth ?? createPasswordlessAuthService(database, bindings, sender))
    : new OidcSessionTerminator();
}

export function createPasskeyRecoveryRepository(database: PrismaDatabase): PrismaPasskeyRecoveryRepository {
  return new PrismaPasskeyRecoveryRepository(database);
}

export function createUserCryptoProfileRepository(database: PrismaDatabase): UserCryptoProfileRepository {
  return new PrismaUserCryptoProfileRepository(database);
}

export function createApplicationUserRepository(
  database: PrismaDatabase,
  bindings: ApiBindings,
): ApplicationUserRepository {
  const admission =
    authBackend(bindings) === "oidc"
      ? (principal: VerifiedPrincipal) =>
          isOidcPrincipalAdmitted(principal, database, configuredAdmittedEmails(bindings.AUTH_ADMITTED_EMAILS))
      : async () => authBackend(bindings) !== "none";
  return new PrismaApplicationUserRepository(database, admission);
}

export function sessionAssuranceSatisfies(actual: SessionAssurance, minimum: SessionAssurance): boolean {
  return assuranceSatisfies(actual, minimum);
}

function configuredAdmittedEmails(value: string | undefined): ReadonlySet<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function disabledPasswordlessAuthService(): PasswordlessAuthService {
  return {
    requestLink: async () => {
      throw new Error("Passwordless authentication is not configured.");
    },
    redeem: async () => null,
    verifyAccessToken: async () => null,
    verifyBrowserSession: async () => null,
    refresh: async () => null,
    revoke: async () => undefined,
    publishPwaHandoff: async () => undefined,
    redeemPwaHandoff: async () => null,
  };
}

function required(value: string | undefined, name: AuthConfigurationField): string {
  const normalized = value?.trim();
  if (!normalized) throw new AuthenticationConfigurationError(name, `${name} is required.`);
  return normalized;
}

function requiredUrl(value: string | undefined, name: AuthConfigurationField, nodeEnv?: string): URL {
  let url: URL;
  try {
    url = new URL(required(value, name));
  } catch {
    throw new AuthenticationConfigurationError(name, `${name} must be a valid URL.`);
  }
  if (url.protocol !== "https:" && !(nodeEnv !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname)))
    throw new AuthenticationConfigurationError(name, `${name} must use HTTPS.`);
  return url;
}
