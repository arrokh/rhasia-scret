import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";
import type { PasswordlessAuthService } from "@api/modules/identity/application/passwordless-authentication";
import type { SessionVerifier } from "@api/modules/identity/application/session-verifier";
import type { SessionTerminator } from "@api/modules/identity/application/session-terminator";
import type { ApplicationUserRepository } from "@api/modules/identity/application/application-user-repository";
import type { UserCryptoProfileRepository } from "@api/modules/identity/application/user-crypto-profile-repository";
import type { ApplicationRateLimitOutcome, ApplicationRateLimitPolicyId } from "@api/modules/rate-limiting";
import type { ApiBindings, ApiEmailSenders } from "@api/types";
import type { ApiRequest } from "@api/http/api-request";

export type ApiRequestContext = Readonly<{
  database: PrismaDatabase;
  bindings: ApiBindings;
  emailSenders?: ApiEmailSenders;
  sessionVerifier: SessionVerifier;
  sessionTerminator: SessionTerminator;
  passwordlessAuth: PasswordlessAuthService;
  applicationUsers: ApplicationUserRepository;
  userCryptoProfiles: UserCryptoProfileRepository;
  checkApplicationRateLimit(
    operation: ApplicationRateLimitPolicyId,
    userId: string,
  ): Promise<ApplicationRateLimitOutcome>;
}>;

const contextKey = Symbol("rhasia.api.request-context");

export function attachApiRequestContext(request: ApiRequest, context: ApiRequestContext): void {
  Object.defineProperty(request, contextKey, { value: context });
}

export function getApiRequestContext(request: Request): ApiRequestContext {
  const context = (request as ApiRequest & { [contextKey]?: ApiRequestContext })[contextKey];
  if (!context) throw new Error("API request context is unavailable.");
  return context;
}
