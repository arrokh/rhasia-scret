import * as Clipboard from "expo-clipboard";
import { createAuthenticatorAccountPayloadPort } from "@rhasia-scret/client-vault-core";
import type { WorkspaceAuthenticatorAccount } from "@rhasia-scret/client-vault-core";
import { generateTotp, type TotpCode } from "@rhasia-scret/client-vault-core";
import { parseTotpUri } from "@rhasia-scret/client-vault-core";
import { bytesToBase64 } from "@rhasia-scret/client-vault-core";
import type { AuthenticatedTransport, ClipboardPort } from "@rhasia-scret/client-vault-core";
import { nativeClientCrypto } from "./native-client-crypto";
import { nativeCryptoPrimitives } from "./native-crypto-primitives";

const payloads = createAuthenticatorAccountPayloadPort(nativeClientCrypto);

export class MobileAuthenticatorAccountRepository {
  public constructor(private readonly transport: AuthenticatedTransport) {}

  public async deleteAccount(account: { id: string; vaultId: string; vaultType: "PERSONAL" | "SHARED"; revision: number }): Promise<void> {
    const base = account.vaultType === "PERSONAL" ? "/api/vaults" : "/api/shared-vaults";
    const response = await this.transport.request({
      url: `${base}/${encodeURIComponent(account.vaultId)}/accounts`,
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: account.id, expectedRevision: account.revision }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Authenticator Account could not be deleted.");
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
      const response = await this.transport.request({
        url: vault.type === "PERSONAL"
          ? `/api/vaults/${encodeURIComponent(vault.id)}/accounts`
          : `/api/shared-vaults/${encodeURIComponent(vault.id)}/accounts`,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ encryptedPayload: bytesToBase64(encryptedPayload), encryptionVersion: 1 }),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("The encrypted Authenticator Account could not be stored.");
      const created = parseCreatedAccount(await response.json<unknown>());
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
  writeText: async (value) => { await Clipboard.setStringAsync(value); },
};

function parseCreatedAccount(value: unknown): { id: string; revision: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidResponse();
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(record.id)) invalidResponse();
  if (typeof record.revision !== "number" || !Number.isSafeInteger(record.revision) || record.revision < 1) invalidResponse();
  return { id: record.id, revision: record.revision };
}

function invalidResponse(): never {
  throw new Error("The Authenticator Account response is invalid.");
}
