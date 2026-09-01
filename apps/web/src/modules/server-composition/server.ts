import { createApplicationUserRepository, createSessionVerifier } from "@/modules/identity/server";
import { checkApplicationRateLimit } from "@/modules/rate-limiting/server";
import { createAuthenticatedApplicationExecutor } from "./application/authenticated-application-request";

const applicationUsers = createApplicationUserRepository();

export const executeAuthenticatedApplicationRequest = createAuthenticatedApplicationExecutor({
  verifySession: async (assurance) => createSessionVerifier(assurance).verify(assurance),
  provisionApplicationUser: (principal) => applicationUsers.provision(principal),
  checkApplicationRateLimit
});

export type { AuthenticatedApplicationRequest, AuthenticatedApplicationResult } from "./application/authenticated-application-request";
