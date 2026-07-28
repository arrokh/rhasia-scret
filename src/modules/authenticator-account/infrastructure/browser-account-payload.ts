"use client";

import { decryptPayload, deserializeEncryptedEnvelope, encryptPayload, serializeEncryptedEnvelope } from "@/modules/crypto";
import type { TotpConfiguration } from "@/modules/otp-runtime";
import { base64ToBytes, bytesToBase64 } from "@/shared/infrastructure/browser-base64";

export type DecryptedAuthenticatorAccount = Omit<TotpConfiguration, "secret"> & { secret: Uint8Array };

const MAX_ACCOUNT_PAYLOAD_BYTES = 16 * 1024;
const MAX_ACCOUNT_LABEL_LENGTH = 240;
const MAX_ACCOUNT_SECRET_BYTES = 512;

export async function encryptAccountConfiguration(vaultKey: Uint8Array, configuration: TotpConfiguration): Promise<Uint8Array> {
  const plaintext = serializeDecryptedAccountPayload(configuration);
  try {
    return serializeEncryptedEnvelope(await encryptPayload(vaultKey, plaintext));
  } finally {
    plaintext.fill(0);
  }
}

export function serializeDecryptedAccountPayload(configuration: TotpConfiguration): Uint8Array {
  const plaintext = new TextEncoder().encode(JSON.stringify({
    issuer: configuration.issuer,
    accountName: configuration.accountName,
    secret: bytesToBase64(configuration.secret),
    algorithm: configuration.algorithm,
    digits: configuration.digits,
    period: configuration.period
  }));
  try {
    const parsed = parseDecryptedAccountPayload(plaintext);
    parsed.secret.fill(0);
    return plaintext;
  } catch (error) {
    plaintext.fill(0);
    throw error;
  }
}

export async function decryptAccountConfiguration(vaultKey: Uint8Array, encryptedPayload: Uint8Array): Promise<DecryptedAuthenticatorAccount> {
  const plaintext = await decryptPayload(vaultKey, deserializeEncryptedEnvelope(encryptedPayload));
  try {
    return parseDecryptedAccountPayload(plaintext);
  } finally {
    plaintext.fill(0);
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
  const fields = Object.keys(record).sort();
  if (fields.join(",") !== "accountName,algorithm,digits,issuer,period,secret") invalidPayload();
  if (!validLabel(record.issuer) || !validLabel(record.accountName) || typeof record.secret !== "string") invalidPayload();
  if (record.algorithm !== "SHA-1" && record.algorithm !== "SHA-256" && record.algorithm !== "SHA-512") invalidPayload();
  if (record.digits !== 6 && record.digits !== 8) invalidPayload();
  if (typeof record.period !== "number" || !Number.isSafeInteger(record.period) || record.period <= 0) invalidPayload();
  let secret: Uint8Array;
  try {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(record.secret)) invalidPayload();
    secret = base64ToBytes(record.secret);
  } catch {
    invalidPayload();
  }
  if (secret.length === 0 || secret.length > MAX_ACCOUNT_SECRET_BYTES) { secret.fill(0); invalidPayload(); }
  return { issuer: record.issuer, accountName: record.accountName, secret, algorithm: record.algorithm, digits: record.digits, period: record.period };
}

export function sortAccounts(accounts: DecryptedAuthenticatorAccount[]): DecryptedAuthenticatorAccount[] {
  return [...accounts].sort((left, right) => left.issuer.localeCompare(right.issuer) || left.accountName.localeCompare(right.accountName));
}

export function isDuplicateAccount(candidate: DecryptedAuthenticatorAccount, accounts: DecryptedAuthenticatorAccount[]): boolean {
  return accounts.some((account) => account.issuer === candidate.issuer && account.accountName === candidate.accountName && account.algorithm === candidate.algorithm && account.digits === candidate.digits && account.period === candidate.period && equalBytes(account.secret, candidate.secret));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function validLabel(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_ACCOUNT_LABEL_LENGTH;
}

function invalidPayload(): never {
  throw new Error("Encrypted account payload is invalid.");
}
