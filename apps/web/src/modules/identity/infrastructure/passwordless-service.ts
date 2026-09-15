import {
  createPasswordlessAuthService,
  isSafePwaHandoffId,
  isSafePwaHandoffVerifier,
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
    buildActionUrl: (client, rawToken, returnPath, handoffId) =>
      buildActionUrl(
        authConfiguration.appOrigin,
        authConfiguration.mobileRedirectUrl,
        client,
        rawToken,
        returnPath,
        handoffId,
      ),
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
  handoffId?: string,
): URL {
  if (client === "pwa" && (!handoffId || !isSafePwaHandoffId(handoffId)))
    throw new Error("PWA authentication handoff is invalid.");
  if (client !== "pwa" && handoffId !== undefined) throw new Error("PWA authentication handoff is invalid.");
  const actionPath = client === "web" ? "/auth/confirm" : client === "pwa" ? "/auth/pwa-confirm" : null;
  const actionUrl = actionPath ? new URL(actionPath, appOrigin) : new URL(mobileRedirectUrl.toString());
  const fragment = new URLSearchParams({ token: rawToken, next: returnPath });
  if (client === "pwa" && handoffId) fragment.set("handoff", handoffId);
  actionUrl.hash = fragment.toString();
  return actionUrl;
}

export function isPasswordlessClient(value: unknown): value is PasswordlessClient {
  return value === "web" || value === "mobile" || value === "pwa";
}

export { isSafePwaHandoffId, isSafePwaHandoffVerifier };

export function isPasswordlessReturnPath(value: unknown): value is PasswordlessReturnPath {
  return value === "/vaults" || value === "/vaults/invitations/redeem";
}
