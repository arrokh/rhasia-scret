import type { ApplicationUser } from "../domain/application-user";
import type { VerifiedSession } from "./session-verifier";

export class ApplicationUserCredentialInvalidatedError extends Error {
  public constructor() {
    super("The authentication credential was issued before account deletion.");
    this.name = "ApplicationUserCredentialInvalidatedError";
  }
}

export interface ApplicationUserRepository {
  provision(session: VerifiedSession): Promise<ApplicationUser>;
}
