import * as Clipboard from "expo-clipboard";
import { createAuthenticatorAccountPayloadPort } from "@rhasia-scret/client-vault-core";
import type { WorkspaceAuthenticatorAccount } from "@rhasia-scret/client-vault-core";
import { generateTotp, type TotpCode } from "@rhasia-scret/client-vault-core";
import { parseTotpUri } from "@rhasia-scret/client-vault-core";
import { bytesToBase64 } from "@rhasia-scret/client-vault-core";
import type { AuthenticatedTransport, ClipboardPort } from "@rhasia-scret/client-vault-core";
import { HostedAuthenticatorAccountTransport } from "@rhasia-scret/client-vault-core";
import { nativeClientCrypto } from "./native-client-crypto";
import { nativeCryptoPrimitives } from "./native-crypto-primitives";

const payloads = createAuthenticatorAccountPayloadPort(nativeClientCrypto);

export class MobileAuthenticatorAccountRepository {
  private readonly hostedAccounts: HostedAuthenticatorAccountTransport;

  public constructor(private readonly transport: AuthenticatedTransport) {
    this.hostedAccounts = new HostedAuthenticatorAccountTransport(transport);
  }

  public async deleteAccount(account: {
    id: string;
    vaultId: string;
    vaultType: "PERSONAL" | "SHARED";
    revision: number;
  }): Promise<void> {
    await this.hostedAccounts.delete(
      { vaultId: account.vaultId, vaultType: account.vaultType },
      { accountId: account.id, expectedRevision: account.revision },
    );
  }

  public async recordSharedVaultAccountAccess(vaultId: string, accountId: string): Promise<void> {
    const response = await this.transport.request({
      url: `/api/shared-vaults/${encodeURIComponent(vaultId)}/audit-events`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventType: "ACCOUNT_ACCESSED", accountId }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Shared Vault account access audit could not be recorded.");
  }

  public async importTotpUri(
    vault: { id: string; name: string; type: "PERSONAL" | "SHARED"; key: Uint8Array },
    uri: string,
  ): Promise<WorkspaceAuthenticatorAccount> {
    const configuration = parseTotpUri(uri.trim());
    let encryptedPayload: Uint8Array | undefined;
    try {
      encryptedPayload = await payloads.encryptAccountConfiguration(vault.key, configuration, {
        purpose: "authenticator-account",
        payloadType: "totp-configuration",
        vaultId: vault.id,
        keyVersion: 1,
      });
      const created = await this.hostedAccounts.create(
        { vaultId: vault.id, vaultType: vault.type },
        { encryptedPayload: bytesToBase64(encryptedPayload), encryptionVersion: 1 },
      );
      return {
        id: created.id,
        vaultId: vault.id,
        vaultName: vault.name,
        vaultType: vault.type,
        revision: created.revision,
        ...configuration,
      };
    } catch (error) {
      configuration.secret.fill(0);
      throw error;
    } finally {
      encryptedPayload?.fill(0);
    }
  }
}

export function generateMobileTotp(account: WorkspaceAuthenticatorAccount, now = new Date()): Promise<TotpCode> {
  return generateTotp(account, { sign: nativeCryptoPrimitives.signHmac }, now);
}

export const nativeClipboard: ClipboardPort = {
  writeText: async (value) => {
    await Clipboard.setStringAsync(value);
  },
};
