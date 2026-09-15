import { ApplicationUserCredentialInvalidatedError } from "./application/application-user-repository";
import type { ApplicationUserRepository } from "./application/application-user-repository";
import { loadApplicationUser } from "./application/load-application-user";
import type { SessionVerifier } from "./application/session-verifier";
import type { SessionTerminator } from "./application/session-terminator";
import type { UserCryptoProfileRepository } from "./application/user-crypto-profile-repository";
import type { PasswordlessAuthService } from "./application/passwordless-authentication";
import { AUTH_RETURN_PATH_COOKIE } from "./application/auth-return-path";
import { readAuthConfiguration, type AuthBackend } from "./infrastructure/auth-backend";
import { readEmailConfiguration } from "./infrastructure/email-configuration";
import { NoneSessionVerifier } from "./infrastructure/none-session-verifier";
import { OidcSessionVerifier } from "./infrastructure/oidc-session-verifier";
import { OidcSessionTerminator } from "./infrastructure/oidc-session-terminator";
import { PrismaApplicationUserRepository } from "./infrastructure/prisma-application-user-repository";
import { PrismaPasskeyRecoveryRepository } from "./infrastructure/prisma-passkey-recovery-repository";
import { PrismaUserCryptoProfileRepository } from "./infrastructure/prisma-user-crypto-profile-repository";
import { isOidcPrincipalAdmitted } from "./infrastructure/prisma-application-admission";
import { PasswordlessSessionTerminator } from "./infrastructure/passwordless-session-terminator";
import { PasswordlessSessionVerifier } from "./infrastructure/passwordless-session-verifier";
import {
  createPasswordlessAuthServiceForServer,
  isPasswordlessClient,
  isPasswordlessReturnPath,
  isSafePwaHandoffId,
  isSafePwaHandoffVerifier,
  readPasswordlessConfiguration,
} from "./infrastructure/passwordless-service";
import { PrismaAnonymousAuthRateLimiter } from "./infrastructure/prisma-anonymous-auth-rate-limiter";
import { isSameOrigin, requestClientIp, requestPublicOrigin } from "./infrastructure/request-origin";
import {
  clearPasswordlessSessionCookies,
  PASSWORDLESS_REFRESH_COOKIE,
  setPasswordlessSessionCookies,
} from "./infrastructure/passwordless-session";

export {
  loadApplicationUser,
  ApplicationUserCredentialInvalidatedError,
  readAuthConfiguration,
  readEmailConfiguration,
};
export type { ApplicationUserRepository, SessionVerifier, UserCryptoProfileRepository };
export type { PasswordlessAuthService };
export {
  isPasswordlessClient,
  isPasswordlessReturnPath,
  isSafePwaHandoffId,
  isSafePwaHandoffVerifier,
  readPasswordlessConfiguration,
  AUTH_RETURN_PATH_COOKIE,
};
export {
  isSameOrigin,
  requestClientIp,
  requestPublicOrigin,
  clearPasswordlessSessionCookies,
  PASSWORDLESS_REFRESH_COOKIE,
  setPasswordlessSessionCookies,
};
export {
  browserE2eAuthenticationVerified,
  browserE2eRegistrationCredential,
} from "./infrastructure/browser-e2e-passkey-verification";
export { passkeyRecoveryConfiguration } from "./infrastructure/passkey-recovery-configuration";

export function authBackend(): AuthBackend {
  try {
    return readAuthConfiguration().backend;
  } catch {
    return "none";
  }
}

export function createPasswordlessAuthService(): PasswordlessAuthService {
  return createPasswordlessAuthServiceForServer();
}

export function createAnonymousAuthRateLimiter(): PrismaAnonymousAuthRateLimiter {
  return new PrismaAnonymousAuthRateLimiter(readPasswordlessConfiguration().magicLinkSecret);
}

export function createSessionVerifier(): SessionVerifier {
  try {
    const configuration = readAuthConfiguration();
    if (configuration.backend === "none") return new NoneSessionVerifier();
    if (configuration.backend === "oidc") return new OidcSessionVerifier(configuration.oidc);
    return new PasswordlessSessionVerifier(
      createPasswordlessAuthServiceForServer(undefined, configuration.passwordless),
      configuration.passwordless,
    );
  } catch {
    return new NoneSessionVerifier();
  }
}

export function createSessionTerminator(): SessionTerminator {
  try {
    const configuration = readAuthConfiguration();
    if (configuration.backend === "oidc") return new OidcSessionTerminator();
    if (configuration.backend === "passwordless") return new PasswordlessSessionTerminator();
  } catch {
    // Invalid authentication configuration fails closed; the fallback only clears browser credential cookies.
  }
  return new OidcSessionTerminator();
}

export function createPasskeyRecoveryRepository(): PrismaPasskeyRecoveryRepository {
  return new PrismaPasskeyRecoveryRepository();
}

export function createUserCryptoProfileRepository(): UserCryptoProfileRepository {
  return new PrismaUserCryptoProfileRepository();
}

export function createApplicationUserRepository(): PrismaApplicationUserRepository {
  try {
    const configuration = readAuthConfiguration();
    return new PrismaApplicationUserRepository(
      configuration.backend === "oidc" ? isOidcPrincipalAdmitted : async () => configuration.backend !== "none",
    );
  } catch {
    return new PrismaApplicationUserRepository(async () => false);
  }
}
