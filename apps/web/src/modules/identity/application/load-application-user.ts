import type { ApplicationUser } from "../domain/application-user";
import {
  ApplicationUserCredentialInvalidatedError,
  type ApplicationUserRepository,
} from "./application-user-repository";
import type { SessionVerifier } from "./session-verifier";

export async function loadApplicationUser(
  sessionVerifier: SessionVerifier,
  applicationUsers: ApplicationUserRepository,
): Promise<ApplicationUser | null> {
  const session = await sessionVerifier.verify();
  if (!session) return null;
  try {
    return await applicationUsers.provision(session);
  } catch (error) {
    if (error instanceof ApplicationUserCredentialInvalidatedError) return null;
    throw error;
  }
}
