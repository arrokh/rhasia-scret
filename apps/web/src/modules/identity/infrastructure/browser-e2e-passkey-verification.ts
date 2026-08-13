import { Buffer } from "node:buffer";
import { browserE2eTestsEnabled } from "./browser-e2e-test-session";

export function browserE2eRegistrationCredential(response: unknown): { credentialId: Uint8Array; publicKey: Uint8Array; transports: string[] } | null {
  if (!browserE2eTestsEnabled() || !isObject(response) || typeof response.id !== "string" || response.type !== "public-key") return null;
  const decodedCredentialId = Buffer.from(response.id, "base64url");
  if (decodedCredentialId.length < 4 || decodedCredentialId.length > 128) return null;
  const credentialId = new Uint8Array(decodedCredentialId);
  if (!isObject(response.clientExtensionResults) || response.clientExtensionResults.browserE2eTest !== true || !isObject(response.clientExtensionResults.prf) || response.clientExtensionResults.prf.enabled !== true) return null;
  return {
    credentialId,
    publicKey: Uint8Array.of(1, 2, 3, 4),
    transports: ["internal"]
  };
}

export function browserE2eAuthenticationVerified(response: unknown, expectedCredentialId: Uint8Array): boolean {
  return browserE2eTestsEnabled()
    && isObject(response)
    && response.id === Buffer.from(expectedCredentialId).toString("base64url")
    && response.type === "public-key"
    && isObject(response.clientExtensionResults)
    && response.clientExtensionResults.browserE2eTest === true
    && isObject(response.response)
    && response.response.userHandle === undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
