"use client";

import { base64UrlToBytes, bytesToBase64Url } from "@/shared/infrastructure/browser-base64";

export async function createPasskeyCredential(options: PublicKeyCredentialCreationOptionsJSON): Promise<{ registrationResponse: unknown; prfOutput: Uint8Array; prfSalt: Uint8Array }> {
  const credential = await navigator.credentials.create({ publicKey: registrationOptions(options) });
  if (!(credential instanceof PublicKeyCredential)) throw new Error("Passkey registration was cancelled.");
  const prfSalt = randomBytes(32);
  if (!options.rp.id) throw new Error("Passkey relying-party identifier is missing.");
  const prfOutput = await evaluatePrf(toArrayBuffer(credential.rawId), options.rp.id, prfSalt);
  return { registrationResponse: registrationResponseJson(credential), prfOutput, prfSalt };
}

export async function evaluatePasskeyPrf(credentialId: Uint8Array, rpId: string, prfSalt: Uint8Array): Promise<Uint8Array> {
  return evaluatePrf(toArrayBuffer(credentialId), rpId, prfSalt);
}

export async function authenticatePasskey(options: PublicKeyCredentialRequestOptionsJSON): Promise<unknown> {
  const credential = await navigator.credentials.get({ publicKey: { challenge: base64UrlToBytes(options.challenge), rpId: options.rpId, timeout: options.timeout, userVerification: options.userVerification as UserVerificationRequirement | undefined, allowCredentials: options.allowCredentials?.map((item) => ({ type: "public-key", id: base64UrlToBytes(item.id), transports: item.transports?.filter(isAuthenticatorTransport) })) } });
  if (!(credential instanceof PublicKeyCredential) || !(credential.response instanceof AuthenticatorAssertionResponse)) throw new Error("Passkey recovery was cancelled.");
  const response = credential.response;
  return { id: credential.id, rawId: toBase64Url(credential.rawId), type: credential.type, response: { authenticatorData: toBase64Url(response.authenticatorData), clientDataJSON: toBase64Url(response.clientDataJSON), signature: toBase64Url(response.signature), userHandle: response.userHandle ? toBase64Url(response.userHandle) : undefined }, clientExtensionResults: credential.getClientExtensionResults() };
}

async function evaluatePrf(credentialId: ArrayBuffer, rpId: string, prfSalt: Uint8Array): Promise<Uint8Array> {
  const challenge = randomBytes(32);
  const extensions = { prf: { eval: { first: toArrayBuffer(prfSalt) } } } as unknown as AuthenticationExtensionsClientInputs;
  const credential = await navigator.credentials.get({ publicKey: { challenge: toArrayBuffer(challenge), rpId, allowCredentials: [{ type: "public-key", id: credentialId }], userVerification: "required", extensions } });
  if (!(credential instanceof PublicKeyCredential)) throw new Error("Passkey recovery was cancelled.");
  const result = credential.getClientExtensionResults() as unknown;
  const first = prfResult(result);
  if (!first) throw new Error("This passkey does not support PRF recovery.");
  return new Uint8Array(first);
}

function registrationOptions(options: PublicKeyCredentialCreationOptionsJSON): PublicKeyCredentialCreationOptions {
  return { challenge: base64UrlToBytes(options.challenge), rp: options.rp, user: { ...options.user, id: base64UrlToBytes(options.user.id) }, pubKeyCredParams: options.pubKeyCredParams, timeout: options.timeout, attestation: options.attestation as AttestationConveyancePreference | undefined, authenticatorSelection: options.authenticatorSelection, excludeCredentials: options.excludeCredentials?.map((credential) => ({ type: "public-key", id: base64UrlToBytes(credential.id), transports: credential.transports?.filter(isAuthenticatorTransport) })), extensions: options.extensions as AuthenticationExtensionsClientInputs };
}

function registrationResponseJson(credential: PublicKeyCredential): unknown {
  const response = credential.response;
  if (!(response instanceof AuthenticatorAttestationResponse)) throw new Error("Passkey registration response is invalid.");
  return { id: credential.id, rawId: toBase64Url(credential.rawId), type: credential.type, response: { attestationObject: toBase64Url(response.attestationObject), clientDataJSON: toBase64Url(response.clientDataJSON), transports: response.getTransports() }, clientExtensionResults: credential.getClientExtensionResults() };
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

function isAuthenticatorTransport(value: string): value is AuthenticatorTransport { return ["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"].includes(value); }
function toArrayBuffer(bytes: ArrayBufferLike | Uint8Array): ArrayBuffer { const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); const copy = new Uint8Array(input.byteLength); copy.set(input); return copy.buffer; }
function toBase64Url(bytes: ArrayBuffer): string { return bytesToBase64Url(new Uint8Array(bytes)); }
function randomBytes(length: number): Uint8Array { const bytes = new Uint8Array(length); crypto.getRandomValues(bytes); return bytes; }
