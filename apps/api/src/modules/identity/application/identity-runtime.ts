import type { ApplicationUserRepository } from "./application-user-repository";
import type { PasswordlessAuthService } from "./passwordless-authentication";
import type { SessionTerminator } from "./session-terminator";
import type { SessionVerifier } from "./session-verifier";
import type { UserCryptoProfileRepository } from "./user-crypto-profile-repository";

export type IdentityRuntime = Readonly<{
  passwordlessAuth: PasswordlessAuthService;
  sessionVerifier: SessionVerifier;
  sessionTerminator: SessionTerminator;
  applicationUsers: ApplicationUserRepository;
  userCryptoProfiles: UserCryptoProfileRepository;
}>;
