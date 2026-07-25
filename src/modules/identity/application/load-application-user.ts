import type { ApplicationUser } from "../domain/application-user";
import type { ApplicationUserRepository } from "./application-user-repository";
import type { SessionVerifier } from "./session-verifier";

export async function loadApplicationUser(
  sessionVerifier: SessionVerifier,
  applicationUsers: ApplicationUserRepository
): Promise<ApplicationUser | null> {
  const session = await sessionVerifier.verify();
  return session ? applicationUsers.provision(session) : null;
}
