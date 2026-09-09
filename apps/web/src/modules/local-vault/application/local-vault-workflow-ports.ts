import type { DecryptedAuthenticatorAccount } from "@/modules/authenticator-account";
import type { TotpConfiguration } from "@/modules/otp-runtime";
import type { CryptoEnvelopeContext, EncryptedEnvelope } from "@/modules/crypto";
import type { LocalVaultRepository } from "./local-vault-repository";

export interface LocalVaultCryptoPort {
  randomBytes(length: number): Uint8Array;
  generateSymmetricKey(): Uint8Array;
  deriveVaultUnlockKey(secret: string, salt: Uint8Array): Promise<Uint8Array>;
  validateVaultUnlockSecret(secret: string): void;
  encryptPayload(key: Uint8Array, plaintext: Uint8Array): Promise<EncryptedEnvelope>;
  decryptPayload(key: Uint8Array, envelope: EncryptedEnvelope): Promise<Uint8Array>;
  encryptPayloadWithContext(
    key: Uint8Array,
    plaintext: Uint8Array,
    context: CryptoEnvelopeContext,
  ): Promise<EncryptedEnvelope>;
  decryptPayloadWithContext(
    key: Uint8Array,
    envelope: EncryptedEnvelope,
    context: CryptoEnvelopeContext,
  ): Promise<Uint8Array>;
  serializeEncryptedEnvelope(envelope: EncryptedEnvelope): Uint8Array;
  deserializeEncryptedEnvelope(bytes: Uint8Array): EncryptedEnvelope;
  createEncryptedVaultExport(
    vaultKey: Uint8Array,
    archiveKey: Uint8Array,
    encryptedName: Uint8Array,
    encryptedAccounts: Uint8Array[],
    context: Pick<CryptoEnvelopeContext, "vaultId" | "profileId">,
    accountIds: string[],
  ): Promise<Uint8Array>;
  openEncryptedVaultExport(
    archiveKey: Uint8Array,
    archive: Uint8Array,
  ): Promise<{ vaultName: string; accounts: Uint8Array[] }>;
}

export interface LocalVaultAccountPayloadPort {
  encryptAccountConfiguration(
    vaultKey: Uint8Array,
    configuration: TotpConfiguration,
    context: CryptoEnvelopeContext,
  ): Promise<Uint8Array>;
  decryptAccountConfiguration(
    vaultKey: Uint8Array,
    encryptedPayload: Uint8Array,
    context: CryptoEnvelopeContext,
  ): Promise<DecryptedAuthenticatorAccount>;
  parseDecryptedAccountPayload(plaintext: Uint8Array): DecryptedAuthenticatorAccount;
  isDuplicateAccount(
    candidate: TotpConfiguration,
    accounts: Array<DecryptedAuthenticatorAccount & { id?: string }>,
  ): boolean;
  serializeDecryptedAccountPayload(configuration: TotpConfiguration): Uint8Array;
}

export type LocalVaultWorkflowDependencies = {
  repository: LocalVaultRepository;
  crypto: LocalVaultCryptoPort;
  accountPayload: LocalVaultAccountPayloadPort;
};
