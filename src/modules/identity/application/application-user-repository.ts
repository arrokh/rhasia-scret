import type { ApplicationUser } from "../domain/application-user";
import type { VerifiedSession } from "./session-verifier";

export interface ApplicationUserRepository {
  provision(session: VerifiedSession): Promise<ApplicationUser>;
}
