import { describe, expect, it } from "vitest";
import {
  LegacySharedVaultSnapshotError,
  parseAuthorizedWorkspaceResponse,
  parseEncryptedOnlineWorkspaceBundle,
  parseEncryptedPersonalOfflineSnapshot,
} from "../src/index";

const envelope = Buffer.from([2, ...Array<number>(28).fill(7)]).toString("base64");
const salt = Buffer.alloc(16, 8).toString("base64");

function personalSnapshot() {
  return {
    schemaVersion: 3 as const,
    profileId: "profile_1",
    synchronizedAt: "2026-01-01T00:00:00.000Z",
    synchronizationToken: "personal_sync_1",
    cryptoProfile: {
      vaultUnlockSalt: salt,
      wrappedUserRootKey: envelope,
      encryptedPersonalVaultKey: envelope,
      encryptionVersion: 1 as const,
    },
    personalVault: {
      vaultId: "personal_1",
      lifecycle: "ACTIVE" as const,
      encryptedName: envelope,
      encryptionVersion: 1 as const,
      accounts: [],
    },
  };
}

function sharedVault() {
  return {
    vaultId: "shared_1",
    lifecycle: "ACTIVE" as const,
    role: "VIEWER" as const,
    effectiveAccountPermissions: {
      permissions: { canAddAccounts: false, canEditAccounts: false, canDeleteAccounts: false },
      sources: {
        canAddAccounts: "VAULT" as const,
        canEditAccounts: "VAULT" as const,
        canDeleteAccounts: "VAULT" as const,
      },
    },
    encryptedName: envelope,
    encryptionVersion: 1 as const,
    encryptedVaultKey: envelope,
    keyVersion: 1,
    accounts: [],
  };
}

function workspaceResponse() {
  return {
    responseVersion: 1 as const,
    workspaceSynchronizationToken: "workspace_sync_1",
    synchronizedAt: "2026-01-01T00:00:00.000Z",
    personalSnapshot: personalSnapshot(),
    sharedVaults: [sharedVault()],
  };
}

describe("offline and online workspace bundle contracts", () => {
  it("rejects legacy snapshots containing Shared Vault data", () => {
    expect(() => parseEncryptedPersonalOfflineSnapshot({ ...personalSnapshot(), sharedVaults: [] })).toThrow(
      LegacySharedVaultSnapshotError,
    );
  });

  it("keeps Shared Vault data in the authorized online response only", () => {
    const response = parseAuthorizedWorkspaceResponse(workspaceResponse());
    expect(response.sharedVaults).toHaveLength(1);
    expect(response.personalSnapshot).not.toHaveProperty("sharedVaults");
  });

  it("rejects mismatched synchronization metadata and unsupported response versions", () => {
    expect(() =>
      parseAuthorizedWorkspaceResponse({
        ...workspaceResponse(),
        synchronizedAt: "2026-01-02T00:00:00.000Z",
      }),
    ).toThrow(/timestamp mismatch/);
    expect(() => parseAuthorizedWorkspaceResponse({ ...workspaceResponse(), responseVersion: 2 })).toThrow(
      /unsupported authorized workspace response version/,
    );
  });

  it("supports the legacy online schema only as a transient workspace contract", () => {
    const legacyOnline = parseEncryptedOnlineWorkspaceBundle({
      schemaVersion: 1,
      profileId: "profile_1",
      synchronizedAt: "2026-01-01T00:00:00.000Z",
      synchronizationToken: "workspace_sync_1",
      cryptoProfile: personalSnapshot().cryptoProfile,
      personalVault: personalSnapshot().personalVault,
      sharedVaults: [
        {
          ...sharedVault(),
          // v1 did not carry effective permission metadata.
          effectiveAccountPermissions: undefined,
        },
      ].map(({ effectiveAccountPermissions: _ignored, ...vault }) => vault),
    });
    expect(legacyOnline.sharedVaults[0]?.effectiveAccountPermissions.permissions).toEqual({
      canAddAccounts: false,
      canEditAccounts: false,
      canDeleteAccounts: false,
    });
  });
});
