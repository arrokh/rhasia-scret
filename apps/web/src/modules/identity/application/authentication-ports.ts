import type { SessionTerminator } from "./session-terminator";
import type { SessionVerifier } from "./session-verifier";

export type SignInRequestResult = "sent" | "rate_limited" | "error";

export interface SignInInitiator {
  requestEmailSignInLink(email: string, redirectTo: string): Promise<SignInRequestResult>;
}

export type IdentityPorts = {
  sessionVerifier: SessionVerifier;
  sessionTerminator: SessionTerminator;
  signInInitiator?: SignInInitiator;
};
