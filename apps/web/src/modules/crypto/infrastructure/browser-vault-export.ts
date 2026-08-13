"use client";

import { MAX_ENCRYPTED_VAULT_ARCHIVE_BYTES, MAX_VAULT_ARCHIVE_ACCOUNTS } from "@rhasia-scret/client-vault-core";
import { createVaultArchiveProtocol } from "@rhasia-scret/client-vault-core";
import { browserClientCryptoPort } from "./browser-client-crypto-port";
import { decryptPayloadWithContext, deserializeEncryptedEnvelope, type CryptoEnvelopeContext } from "./browser-crypto-envelope";

export { MAX_ENCRYPTED_VAULT_ARCHIVE_BYTES, MAX_VAULT_ARCHIVE_ACCOUNTS };
const protocol = createVaultArchiveProtocol(browserClientCryptoPort);

/** Produces a portable encrypted archive from normalized plaintext held only in browser memory. */
export const createEncryptedVaultArchive = protocol.createEncryptedVaultArchive;

/** Opens a supported archive in the browser; callers must validate and immediately re-encrypt every account. */
export const openEncryptedVaultExport = protocol.openEncryptedVaultExport;

/** Produces the same archive from existing Vault ciphertext without exposing plaintext to callers. */
export async function createEncryptedVaultExport(
  vaultKey: Uint8Array,
  archiveKey: Uint8Array,
  encryptedName: Uint8Array,
  encryptedAccounts: Uint8Array[],
  context: Pick<CryptoEnvelopeContext, "vaultId" | "profileId"> = {},
  accountIds: string[] = [],
): Promise<Uint8Array> {
  if (encryptedAccounts.length > MAX_VAULT_ARCHIVE_ACCOUNTS) throw new Error("Encrypted vault export is too large.");
  const nameBytes = await decryptPayloadWithContext(vaultKey, deserializeEncryptedEnvelope(encryptedName), {
    purpose: "vault-name",
    payloadType: "vault-name",
    ...context,
    keyVersion: 1,
  });
  const accountPlaintexts: Uint8Array[] = [];
  try {
    const vaultName = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
    for (const [index, account] of encryptedAccounts.entries()) {
      accountPlaintexts.push(await decryptPayloadWithContext(vaultKey, deserializeEncryptedEnvelope(account), {
        purpose: "authenticator-account",
        payloadType: "totp-configuration",
        ...context,
        accountId: accountIds[index],
        keyVersion: 1,
      }));
    }
    return await createEncryptedVaultArchive(archiveKey, vaultName, accountPlaintexts);
  } finally {
    nameBytes.fill(0);
    for (const account of accountPlaintexts) account.fill(0);
  }
}
