import type { CryptoEnvelopeContext } from "@/modules/crypto/application/encrypted-envelope-types";
import type { TotpConfiguration } from "@/modules/otp-runtime/domain/totp-configuration";

export type DecryptedAuthenticatorAccount = Omit<TotpConfiguration, "secret"> & { secret: Uint8Array };

export interface AuthenticatorAccountPayloadPort {
  encryptAccountConfiguration(vaultKey: Uint8Array, configuration: TotpConfiguration, context?: CryptoEnvelopeContext): Promise<Uint8Array>;
  decryptAccountConfiguration(vaultKey: Uint8Array, encryptedPayload: Uint8Array, context?: CryptoEnvelopeContext): Promise<DecryptedAuthenticatorAccount>;
  serializeDecryptedAccountPayload(configuration: TotpConfiguration): Uint8Array;
  parseDecryptedAccountPayload(plaintext: Uint8Array): DecryptedAuthenticatorAccount;
  isDuplicateAccount(candidate: DecryptedAuthenticatorAccount, accounts: DecryptedAuthenticatorAccount[]): boolean;
}
