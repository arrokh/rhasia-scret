import {
  createPasswordlessAuthService,
  type PasswordlessAuthRepository,
  type PasswordlessClient,
  type PasswordlessReturnPath,
} from "../application/passwordless-authentication";
import { readAuthConfiguration, type PasswordlessConfiguration } from "./auth-backend";
import { readEmailConfiguration } from "./email-configuration";
import { createNodemailerEmailSender } from "./nodemailer-email-sender";
import { createPasswordlessTokenGenerator } from "./passwordless-crypto";
import { PrismaPasswordlessAuthRepository } from "./prisma-passwordless-auth-repository";

export function createPasswordlessAuthServiceForServer(
  repository?: PasswordlessAuthRepository,
  configuration?: PasswordlessConfiguration,
) {
  const authConfiguration = configuration ?? readPasswordlessConfiguration();
  const tokenGenerator = createPasswordlessTokenGenerator(authConfiguration.magicLinkSecret);
  return createPasswordlessAuthService({
    repository: repository ?? new PrismaPasswordlessAuthRepository(authConfiguration),
    sender: createNodemailerEmailSender(readEmailConfiguration()),
    generateToken: () => tokenGenerator.generate(),
    digestToken: (token) => tokenGenerator.digest(token),
    buildActionUrl: (client, rawToken, returnPath) =>
      buildActionUrl(authConfiguration.appOrigin, authConfiguration.mobileRedirectUrl, client, rawToken, returnPath),
    magicLinkTtlSeconds: authConfiguration.magicLinkTtlSeconds,
  });
}

export function readPasswordlessConfiguration(): PasswordlessConfiguration {
  const configuration = readAuthConfiguration();
  if (configuration.backend !== "passwordless") throw new Error("Passwordless authentication is not configured.");
  return configuration.passwordless;
}

export function buildActionUrl(
  appOrigin: URL,
  mobileRedirectUrl: URL,
  client: PasswordlessClient,
  rawToken: string,
  returnPath: PasswordlessReturnPath,
): URL {
  const actionUrl = new URL(client === "web" ? "/auth/confirm" : mobileRedirectUrl.toString(), appOrigin);
  actionUrl.hash = new URLSearchParams({ token: rawToken, next: returnPath }).toString();
  return actionUrl;
}

export function isPasswordlessClient(value: unknown): value is PasswordlessClient {
  return value === "web" || value === "mobile";
}

export function isPasswordlessReturnPath(value: unknown): value is PasswordlessReturnPath {
  return value === "/vaults" || value === "/vaults/invitations/redeem";
}
