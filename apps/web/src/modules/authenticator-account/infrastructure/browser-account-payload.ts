"use client";

import { browserClientCryptoPort, type CryptoEnvelopeContext } from "@/modules/crypto";
import type { TotpConfiguration } from "@/modules/otp-runtime";
import {
  createAuthenticatorAccountPayloadPort,
  isDuplicateAccount,
  parseDecryptedAccountPayload,
  serializeDecryptedAccountPayload,
} from "@rhasia-scret/client-vault-core";
import type { DecryptedAuthenticatorAccount } from "@rhasia-scret/client-vault-core";

export type { DecryptedAuthenticatorAccount } from "@rhasia-scret/client-vault-core";
export { isDuplicateAccount, parseDecryptedAccountPayload, serializeDecryptedAccountPayload };

export const browserAccountPayloadPort = {
  encryptAccountConfiguration: (
    ...args: Parameters<ReturnType<typeof createBrowserAccountPayloadPort>["encryptAccountConfiguration"]>
  ) => createBrowserAccountPayloadPort().encryptAccountConfiguration(...args),
  decryptAccountConfiguration: (
    ...args: Parameters<ReturnType<typeof createBrowserAccountPayloadPort>["decryptAccountConfiguration"]>
  ) => createBrowserAccountPayloadPort().decryptAccountConfiguration(...args),
  serializeDecryptedAccountPayload,
  parseDecryptedAccountPayload,
  isDuplicateAccount,
};

function createBrowserAccountPayloadPort() {
  return createAuthenticatorAccountPayloadPort(browserClientCryptoPort);
}

export function encryptAccountConfiguration(
  vaultKey: Uint8Array,
  configuration: TotpConfiguration,
  context?: CryptoEnvelopeContext,
): Promise<Uint8Array> {
  return browserAccountPayloadPort.encryptAccountConfiguration(vaultKey, configuration, context);
}

export function decryptAccountConfiguration(
  vaultKey: Uint8Array,
  encryptedPayload: Uint8Array,
  context?: CryptoEnvelopeContext,
): Promise<DecryptedAuthenticatorAccount> {
  return browserAccountPayloadPort.decryptAccountConfiguration(vaultKey, encryptedPayload, context);
}

export function sortAccounts(accounts: DecryptedAuthenticatorAccount[]): DecryptedAuthenticatorAccount[] {
  return [...accounts].sort(
    (left, right) => left.issuer.localeCompare(right.issuer) || left.accountName.localeCompare(right.accountName),
  );
}
