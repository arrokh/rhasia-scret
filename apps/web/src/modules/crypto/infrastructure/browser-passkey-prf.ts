"use client";

import { base64UrlToBytes, bytesToBase64Url } from "@/shared/infrastructure/browser-base64";

export class PasskeyPrfUnsupportedError extends Error {
  public constructor() {
    super("Passkey PRF is unsupported.");
    this.name = "PasskeyPrfUnsupportedError";
  }
}

export async function createPasskeyCredential(
  options: PublicKeyCredentialCreationOptionsJSON,
): Promise<{ registrationResponse: unknown; prfOutput: Uint8Array; prfSalt: Uint8Array }> {
  if (!options.rp.id) throw new Error("Passkey relying-party identifier is missing.");
  const credential = await navigator.credentials.create({ publicKey: registrationOptions(options) });
  if (!(credential instanceof PublicKeyCredential)) throw new Error("Passkey registration was cancelled.");
  const prfSalt = randomBytes(32);
  let prfOutput: Uint8Array | undefined;
  try {
    prfOutput = await evaluatePrf(toArrayBuffer(credential.rawId), options.rp.id, prfSalt);
    return { registrationResponse: registrationResponseJson(credential), prfOutput, prfSalt };
  } catch (error) {
    prfOutput?.fill(0);
    prfSalt.fill(0);
    throw error;
  }
}

export async function evaluatePasskeyPrf(
  credentialId: Uint8Array,
  rpId: string,
  prfSalt: Uint8Array,
): Promise<Uint8Array> {
  return evaluatePrf(toArrayBuffer(credentialId), rpId, prfSalt);
}

export async function authenticatePasskey(
  options: PublicKeyCredentialRequestOptionsJSON,
  prfSalt: Uint8Array,
): Promise<{ response: unknown; prfOutput: Uint8Array }> {
  if (prfSalt.length !== 32) throw new Error("Passkey PRF salt is invalid.");
  const extensions = {
    prf: { eval: { first: toArrayBuffer(prfSalt) } },
  } as unknown as AuthenticationExtensionsClientInputs;
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: base64UrlToBytes(options.challenge),
      rpId: options.rpId,
      timeout: options.timeout,
      userVerification: "required",
      extensions,
      allowCredentials: options.allowCredentials?.map((item) => ({
        type: "public-key",
        id: base64UrlToBytes(item.id),
        transports: item.transports?.filter(isAuthenticatorTransport),
      })),
    },
  });
  if (!(credential instanceof PublicKeyCredential) || !(credential.response instanceof AuthenticatorAssertionResponse))
    throw new Error("Passkey recovery was cancelled.");
  const response = credential.response;
  const clientExtensionResults = credential.getClientExtensionResults();
  const first = prfResult(clientExtensionResults);
  if (!first || first.byteLength !== 32) {
    clearPrfResult(clientExtensionResults);
    throw new PasskeyPrfUnsupportedError();
  }
  try {
    // PRF results are key material: never serialize client extension results.
    const assertion = {
      id: credential.id,
      rawId: toBase64Url(credential.rawId),
      type: credential.type,
      response: {
        authenticatorData: toBase64Url(response.authenticatorData),
        clientDataJSON: toBase64Url(response.clientDataJSON),
        signature: toBase64Url(response.signature),
        userHandle: response.userHandle ? toBase64Url(response.userHandle) : undefined,
      },
      clientExtensionResults: serverSafeExtensionResults(clientExtensionResults),
    };
    return { response: assertion, prfOutput: new Uint8Array(first.slice(0)) };
  } finally {
    clearPrfResult(clientExtensionResults);
  }
}

async function evaluatePrf(credentialId: ArrayBuffer, rpId: string, prfSalt: Uint8Array): Promise<Uint8Array> {
  const challenge = randomBytes(32);
  const extensions = {
    prf: { eval: { first: toArrayBuffer(prfSalt) } },
  } as unknown as AuthenticationExtensionsClientInputs;
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: toArrayBuffer(challenge),
      rpId,
      allowCredentials: [{ type: "public-key", id: credentialId }],
      userVerification: "required",
      extensions,
    },
  });
  if (!(credential instanceof PublicKeyCredential)) throw new Error("Passkey recovery was cancelled.");
  const result = credential.getClientExtensionResults() as unknown;
  const first = prfResult(result);
  if (!first) {
    clearPrfResult(result);
    throw new PasskeyPrfUnsupportedError();
  }
  try {
    return new Uint8Array(first.slice(0));
  } finally {
    clearPrfResult(result);
  }
}

function registrationOptions(options: PublicKeyCredentialCreationOptionsJSON): PublicKeyCredentialCreationOptions {
  return {
    challenge: base64UrlToBytes(options.challenge),
    rp: options.rp,
    user: { ...options.user, id: base64UrlToBytes(options.user.id) },
    pubKeyCredParams: options.pubKeyCredParams,
    timeout: options.timeout,
    attestation: options.attestation as AttestationConveyancePreference | undefined,
    authenticatorSelection: options.authenticatorSelection,
    excludeCredentials: options.excludeCredentials?.map((credential) => ({
      type: "public-key",
      id: base64UrlToBytes(credential.id),
      transports: credential.transports?.filter(isAuthenticatorTransport),
    })),
    extensions: options.extensions as AuthenticationExtensionsClientInputs,
  };
}

function registrationResponseJson(credential: PublicKeyCredential): unknown {
  const clientExtensionResults = credential.getClientExtensionResults();
  try {
    const response = credential.response;
    if (!(response instanceof AuthenticatorAttestationResponse))
      throw new Error("Passkey registration response is invalid.");
    return {
      id: credential.id,
      rawId: toBase64Url(credential.rawId),
      type: credential.type,
      response: {
        attestationObject: toBase64Url(response.attestationObject),
        clientDataJSON: toBase64Url(response.clientDataJSON),
        transports: response.getTransports(),
      },
      clientExtensionResults: serverSafeRegistrationExtensionResults(clientExtensionResults),
    };
  } finally {
    clearPrfResult(clientExtensionResults);
  }
}

function serverSafeRegistrationExtensionResults(value: unknown): Record<string, unknown> {
  if (!isObject(value)) return {};
  const safe: Record<string, unknown> = {};
  if (value.browserE2eTest === true) safe.browserE2eTest = true;
  if (isObject(value.prf) && typeof value.prf.enabled === "boolean") safe.prf = { enabled: value.prf.enabled };
  return safe;
}

function serverSafeExtensionResults(value: unknown): Record<string, true> {
  if (!isObject(value)) return {};
  return value.browserE2eTest === true ? { browserE2eTest: true } : {};
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clearPrfResult(value: unknown): void {
  if (!isObject(value) || !isObject(value.prf) || !isObject(value.prf.results)) return;
  for (const output of Object.values(value.prf.results)) {
    if (output instanceof ArrayBuffer) new Uint8Array(output).fill(0);
  }
}

function prfResult(value: unknown): ArrayBuffer | null {
  if (!value || typeof value !== "object") return null;
  const prf = (value as Record<string, unknown>).prf;
  if (!prf || typeof prf !== "object") return null;
  const results = (prf as Record<string, unknown>).results;
  if (!results || typeof results !== "object") return null;
  const first = (results as Record<string, unknown>).first;
  return first instanceof ArrayBuffer ? first : null;
}

function isAuthenticatorTransport(value: string): value is AuthenticatorTransport {
  return ["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"].includes(value);
}
function toArrayBuffer(bytes: ArrayBufferLike | Uint8Array): ArrayBuffer {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const copy = new Uint8Array(input.byteLength);
  copy.set(input);
  return copy.buffer;
}
function toBase64Url(bytes: ArrayBuffer): string {
  return bytesToBase64Url(new Uint8Array(bytes));
}
function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}
