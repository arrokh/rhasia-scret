import type { CryptoEnvelopeContext } from "../../crypto/application/encrypted-envelope-types";
import type { TotpConfiguration } from "../../otp-runtime/domain/totp-configuration";

export type AccountPayloadConfiguration = TotpConfiguration & { tags?: string[] };
export type DecryptedAuthenticatorAccount = Omit<TotpConfiguration, "secret"> & {
  secret: Uint8Array;
  tags?: string[];
};

export interface AuthenticatorAccountPayloadPort {
  encryptAccountConfiguration(
    vaultKey: Uint8Array,
    configuration: AccountPayloadConfiguration,
    context?: CryptoEnvelopeContext,
  ): Promise<Uint8Array>;
  decryptAccountConfiguration(
    vaultKey: Uint8Array,
    encryptedPayload: Uint8Array,
    context?: CryptoEnvelopeContext,
  ): Promise<DecryptedAuthenticatorAccount>;
  serializeDecryptedAccountPayload(configuration: AccountPayloadConfiguration): Uint8Array;
  parseDecryptedAccountPayload(plaintext: Uint8Array): DecryptedAuthenticatorAccount;
  isDuplicateAccount(candidate: DecryptedAuthenticatorAccount, accounts: DecryptedAuthenticatorAccount[]): boolean;
}
