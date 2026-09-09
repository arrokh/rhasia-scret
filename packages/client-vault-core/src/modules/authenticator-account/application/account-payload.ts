import type { ClientCryptoPort } from "../../crypto/application/crypto-ports";
import type { CryptoEnvelopeContext } from "../../crypto/application/encrypted-envelope-types";
import type { TotpConfiguration } from "../../otp-runtime/domain/totp-configuration";
import { base64ToBytes, bytesToBase64 } from "../../../shared/application/base64";
import type { AuthenticatorAccountPayloadPort, DecryptedAuthenticatorAccount } from "./account-payload-ports";

const MAX_ACCOUNT_PAYLOAD_BYTES = 16 * 1024;
const MAX_ACCOUNT_LABEL_LENGTH = 240;
const MAX_ACCOUNT_SECRET_BYTES = 512;

export function createAuthenticatorAccountPayloadPort(crypto: ClientCryptoPort): AuthenticatorAccountPayloadPort {
  return {
    encryptAccountConfiguration: async (vaultKey, configuration, context = accountContext()) => {
      const plaintext = serializeDecryptedAccountPayload(configuration);
      try {
        return crypto.serializeEncryptedEnvelope(await crypto.encryptPayloadWithContext(vaultKey, plaintext, context));
      } finally {
        plaintext.fill(0);
      }
    },
    decryptAccountConfiguration: async (vaultKey, encryptedPayload, context = accountContext()) => {
      const envelope = crypto.deserializeEncryptedEnvelope(encryptedPayload);
      const plaintext =
        envelope.version === 1
          ? await crypto.decryptPayload(vaultKey, envelope)
          : await crypto.decryptPayloadWithContext(vaultKey, envelope, context);
      try {
        return parseDecryptedAccountPayload(plaintext);
      } finally {
        plaintext.fill(0);
      }
    },
    serializeDecryptedAccountPayload,
    parseDecryptedAccountPayload,
    isDuplicateAccount,
  };
}

export function serializeDecryptedAccountPayload(configuration: TotpConfiguration): Uint8Array {
  const plaintext = new TextEncoder().encode(
    JSON.stringify({
      issuer: configuration.issuer,
      accountName: configuration.accountName,
      secret: bytesToBase64(configuration.secret),
      algorithm: configuration.algorithm,
      digits: configuration.digits,
      period: configuration.period,
    }),
  );
  try {
    const parsed = parseDecryptedAccountPayload(plaintext);
    parsed.secret.fill(0);
    return plaintext;
  } catch (error) {
    plaintext.fill(0);
    throw error;
  }
}

export function parseDecryptedAccountPayload(plaintext: Uint8Array): DecryptedAuthenticatorAccount {
  if (plaintext.length === 0 || plaintext.length > MAX_ACCOUNT_PAYLOAD_BYTES) invalidPayload();
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
  } catch {
    invalidPayload();
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) invalidPayload();
  const record = decoded as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "accountName,algorithm,digits,issuer,period,secret") invalidPayload();
  if (!validLabel(record.issuer) || !validLabel(record.accountName) || typeof record.secret !== "string")
    invalidPayload();
  if (record.algorithm !== "SHA-1" && record.algorithm !== "SHA-256" && record.algorithm !== "SHA-512")
    invalidPayload();
  if (record.digits !== 6 && record.digits !== 8) invalidPayload();
  if (typeof record.period !== "number" || !Number.isSafeInteger(record.period) || record.period <= 0) invalidPayload();
  let secret: Uint8Array;
  try {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(record.secret)) invalidPayload();
    secret = base64ToBytes(record.secret);
  } catch {
    invalidPayload();
  }
  if (secret.length === 0 || secret.length > MAX_ACCOUNT_SECRET_BYTES) {
    secret.fill(0);
    invalidPayload();
  }
  return {
    issuer: record.issuer,
    accountName: record.accountName,
    secret,
    algorithm: record.algorithm,
    digits: record.digits,
    period: record.period,
  };
}

export function isDuplicateAccount(
  candidate: DecryptedAuthenticatorAccount,
  accounts: DecryptedAuthenticatorAccount[],
): boolean {
  return accounts.some(
    (account) =>
      account.issuer === candidate.issuer &&
      account.accountName === candidate.accountName &&
      account.algorithm === candidate.algorithm &&
      account.digits === candidate.digits &&
      account.period === candidate.period &&
      equalBytes(account.secret, candidate.secret),
  );
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function validLabel(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_ACCOUNT_LABEL_LENGTH;
}

function accountContext(): CryptoEnvelopeContext {
  return { purpose: "authenticator-account", payloadType: "totp-configuration", protocolVersion: 1, keyVersion: 1 };
}

function invalidPayload(): never {
  throw new Error("Encrypted account payload is invalid.");
}
