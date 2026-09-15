import { redirect } from "next/navigation";
import { createApplicationUserRepository, createSessionVerifier } from "@/modules/identity/server";
import { readAuthConfiguration } from "@/modules/identity/server";
import { createNodemailerAccountDeletionEmailSender } from "./infrastructure/nodemailer-account-deletion-email-sender";
import type { AccountDeletionEmailSender } from "./application/account-deletion-email";
import type { AccountDeletionRepository } from "./application/account-deletion-repository";
import type { AccountDeletionAuthBackend, AccountDeletionRequest } from "./domain/account-deletion-policy";
import {
  AccountDeletionAuthorizationError,
  AccountDeletionChallengeUnavailableError,
  AccountDeletionOtpInvalidError,
  AccountDeletionOtpLockedError,
  AccountDeletionPlanStaleError,
} from "./domain/account-deletion-errors";
import {
  ACCOUNT_DELETION_AUTHORIZATION_COOKIE,
  ACCOUNT_DELETION_OIDC_CHALLENGE_COOKIE,
  clearDeletionCookies,
  setDeletionAuthorizationCookie,
  setDeletionOidcChallengeCookie,
} from "./infrastructure/account-deletion-authorization";
import {
  isBrowserAccountDeletionReadRequest,
  isBrowserAccountDeletionRequest,
  noStoreHeaders,
} from "./infrastructure/account-deletion-request";
import { PrismaAccountDeletionRepository } from "./infrastructure/prisma-account-deletion-repository";

export type { AccountDeletionEmailSender, AccountDeletionRepository, AccountDeletionRequest };
export {
  ACCOUNT_DELETION_AUTHORIZATION_COOKIE,
  ACCOUNT_DELETION_OIDC_CHALLENGE_COOKIE,
  AccountDeletionAuthorizationError,
  AccountDeletionChallengeUnavailableError,
  AccountDeletionOtpInvalidError,
  AccountDeletionOtpLockedError,
  AccountDeletionPlanStaleError,
  clearDeletionCookies,
  isBrowserAccountDeletionReadRequest,
  isBrowserAccountDeletionRequest,
  noStoreHeaders,
  setDeletionAuthorizationCookie,
  setDeletionOidcChallengeCookie,
};

export function createAccountDeletionRepository(): AccountDeletionRepository {
  return new LazyAccountDeletionRepository();
}

class LazyAccountDeletionRepository implements AccountDeletionRepository {
  private delegate: PrismaAccountDeletionRepository | null = null;

  public getPreview(applicationUserId: string) {
    return this.repository().getPreview(applicationUserId);
  }

  public createPasswordlessOtpChallenge(applicationUserId: string, now: Date) {
    return this.repository().createPasswordlessOtpChallenge(applicationUserId, now);
  }

  public verifyPasswordlessOtp(applicationUserId: string, otp: string, now: Date) {
    return this.repository().verifyPasswordlessOtp(applicationUserId, otp, now);
  }

  public createOidcReauthenticationChallenge(applicationUserId: string, now: Date) {
    return this.repository().createOidcReauthenticationChallenge(applicationUserId, now);
  }

  public completeOidcReauthentication(challengeId: string, issuer: string, subject: string, now: Date) {
    return this.repository().completeOidcReauthentication(challengeId, issuer, subject, now);
  }

  public findCompletedDeletion(authorizationToken: string) {
    return this.repository().findCompletedDeletion(authorizationToken);
  }

  public deleteUser(
    applicationUserId: string,
    authorizationToken: string,
    authBackend: AccountDeletionAuthBackend,
    request: AccountDeletionRequest,
    now: Date,
  ) {
    return this.repository().deleteUser(applicationUserId, authorizationToken, authBackend, request, now);
  }

  public recordCompletionEmailStatus(receiptId: string, status: "SENT" | "FAILED") {
    return this.repository().recordCompletionEmailStatus(receiptId, status);
  }

  private repository(): PrismaAccountDeletionRepository {
    if (this.delegate) return this.delegate;
    const configuration = readAuthConfiguration();
    if (configuration.backend === "none") throw new Error("Account deletion requires an authentication backend.");
    this.delegate =
      configuration.backend === "oidc"
        ? new PrismaAccountDeletionRepository(configuration.oidc.sessionSecret)
        : new PrismaAccountDeletionRepository(
            configuration.passwordless.sessionSecret,
            undefined,
            configuration.passwordless.magicLinkSecret,
          );
    return this.delegate;
  }
}

export function createAccountDeletionEmailSender(): AccountDeletionEmailSender {
  let delegate: AccountDeletionEmailSender | null = null;
  const sender = (): AccountDeletionEmailSender => {
    if (!delegate) delegate = createNodemailerAccountDeletionEmailSender();
    return delegate;
  };
  return {
    sendDeletionOtpEmail: (email) => sender().sendDeletionOtpEmail(email),
    sendDeletionCompletionEmail: (email) => sender().sendDeletionCompletionEmail(email),
  };
}

export async function loadAccountDeletionPageContext(): Promise<
  Readonly<{ email: string; authBackend: "passwordless" | "oidc" }>
> {
  const principal = await createSessionVerifier().verify("fresh-provider-user");
  if (!principal) redirect("/sign-in");
  let user;
  try {
    user = await createApplicationUserRepository().provision(principal);
  } catch {
    redirect("/sign-in");
  }
  if (!user.canAccessApplication()) redirect("/sign-in");
  const backend = readAuthConfiguration().backend;
  if (backend !== "passwordless" && backend !== "oidc") redirect("/sign-in");
  return { email: user.email, authBackend: backend };
}
