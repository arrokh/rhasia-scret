"use client";

import { decryptPayload, deserializeEncryptedEnvelope, encryptPayload, serializeEncryptedEnvelope } from "@/modules/crypto";
import type { TotpConfiguration } from "@/modules/otp-runtime";

export type DecryptedAuthenticatorAccount = Omit<TotpConfiguration, "secret"> & { secret: Uint8Array };

export async function encryptAccountConfiguration(vaultKey: Uint8Array, configuration: TotpConfiguration): Promise<Uint8Array> {
  const payload = JSON.stringify({
    issuer: configuration.issuer,
    accountName: configuration.accountName,
    secret: toBase64(configuration.secret),
    algorithm: configuration.algorithm,
    digits: configuration.digits,
    period: configuration.period
  });
  return serializeEncryptedEnvelope(await encryptPayload(vaultKey, new TextEncoder().encode(payload)));
}

export async function decryptAccountConfiguration(vaultKey: Uint8Array, encryptedPayload: Uint8Array): Promise<DecryptedAuthenticatorAccount> {
  const decoded: unknown = JSON.parse(new TextDecoder().decode(await decryptPayload(vaultKey, deserializeEncryptedEnvelope(encryptedPayload))));
  if (!decoded || typeof decoded !== "object") throw new Error("Encrypted account payload is invalid.");
  const record = decoded as Record<string, unknown>;
  if (typeof record.issuer !== "string" || typeof record.accountName !== "string" || typeof record.secret !== "string") {
    throw new Error("Encrypted account payload is invalid.");
  }
  if (record.algorithm !== "SHA-1" && record.algorithm !== "SHA-256" && record.algorithm !== "SHA-512") throw new Error("Encrypted account payload is invalid.");
  if (record.digits !== 6 && record.digits !== 8) throw new Error("Encrypted account payload is invalid.");
  if (typeof record.period !== "number" || !Number.isSafeInteger(record.period) || record.period <= 0) throw new Error("Encrypted account payload is invalid.");
  return { issuer: record.issuer, accountName: record.accountName, secret: fromBase64(record.secret), algorithm: record.algorithm, digits: record.digits, period: record.period };
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

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
