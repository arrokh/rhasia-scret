import type {
  AuthenticatedTransport,
  AuthorizedWorkspaceResponse,
  EncryptedPersonalOfflineSnapshot,
  PlatformHttpRequest,
  PlatformHttpResponse,
  VaultWorkspacePlatformPorts,
} from "@rhasia-scret/client-vault-core";
import {
  base64ToBytes,
  bytesToBase64,
  clearUnlockedVaultWorkspace,
  loadUnlockedVaultWorkspace,
  refreshUnlockedVaultWorkspace,
} from "@rhasia-scret/client-vault-core";
import type { NetInfoState } from "@react-native-community/netinfo";
import { createMobileVaultWorkspacePorts, NativeNetworkStatus } from "./mobile-vault-workspace";
import { nativeClientCrypto } from "./native-client-crypto";
import { nativeCryptoPrimitives } from "./native-crypto-primitives";

jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: {
    fetch: async () => ({ isConnected: true, isInternetReachable: true }),
    addEventListener: () => ({ remove: () => undefined }),
  },
}));

describe("mobile Vault workspace transport", () => {
  it("stops listening to native network changes after the last lifecycle subscriber leaves", () => {
    const remove = jest.fn();
    const state = { isConnected: true, isInternetReachable: true } as NetInfoState;
    const netInfo = {
      fetch: jest.fn(async () => state),
      addEventListener: jest.fn(() => ({ remove })),
    };
    const network = new NativeNetworkStatus(netInfo);
    const dispose = network.subscribe(jest.fn());

    expect(netInfo.addEventListener).toHaveBeenCalledTimes(1);
    dispose();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("fetches the transient online workspace contract without caching", async () => {
    const transport = new StubTransport(response(200, workspaceResponse()));
    const ports = createMobileVaultWorkspacePorts(transport);

    await expect(ports.data.fetchAuthorizedWorkspaceBundle()).resolves.toEqual(workspaceResponse());
    expect(transport.requests).toEqual([
      {
        url: "/v1/sync/workspace-bundle",
        method: "GET",
        cache: "no-store",
      },
    ]);
  });

  it("fails closed on malformed workspace responses", async () => {
    const ports = createMobileVaultWorkspacePorts(new StubTransport(response(200, { plaintextSecret: "forbidden" })));
    await expect(ports.data.fetchAuthorizedWorkspaceBundle()).rejects.toThrow(/Authorized workspace response/);
  });

  it("retrieves a legacy identity, commits its on-device migration, then opens a Shared Vault from v2", async () => {
    await withUniqueNativeRandom(async () => {
      const userRootKey = new Uint8Array(32).fill(71);
      const personalVaultKey = new Uint8Array(32).fill(72);
      const unlockKey = new Uint8Array(32).fill(73);
      const sharedVaultKey = new Uint8Array(32).fill(74);
      const salt = new Uint8Array(16).fill(75);
      const keyPair = await nativeClientCrypto.generateUserEncryptionKeyPair();
      const privateKeyPlaintext = new TextEncoder().encode(JSON.stringify(keyPair.privateKey));
      const legacyEnvelope = await nativeClientCrypto.encryptPayload(userRootKey, privateKeyPlaintext);
      const legacyCiphertext = nativeClientCrypto.serializeEncryptedEnvelope(legacyEnvelope);
      const profileId = "profile_synthetic_01";
      const personalVaultId = "personal_synthetic_01";
      const sharedVaultId = "shared_synthetic_01";
      const wrappedRootKey = await encryptContext(unlockKey, userRootKey, {
        purpose: "user-root-key-wrap",
        payloadType: "user-root-key",
        keyVersion: 1,
      });
      const legacyPersonalKeyEnvelope = await nativeClientCrypto.encryptPayload(userRootKey, personalVaultKey);
      const encryptedPersonalKeyBytes = nativeClientCrypto.serializeEncryptedEnvelope(legacyPersonalKeyEnvelope);
      const encryptedPersonalKey = bytesToBase64(encryptedPersonalKeyBytes);
      const sharedName = await encryptContext(sharedVaultKey, "Shared Synthetic Vault", {
        purpose: "vault-name",
        payloadType: "vault-name",
        vaultId: sharedVaultId,
        keyVersion: 1,
      });
      const sharedKeyPackage = await nativeClientCrypto.wrapKeyForRecipient(sharedVaultKey, keyPair.publicKey);
      const serializedSharedKeyPackage = nativeClientCrypto.serializeKeyWrapEnvelope(sharedKeyPackage);
      const encryptedSharedKey = bytesToBase64(serializedSharedKeyPackage);
      const encryptedPersonalName = await encryptContext(personalVaultKey, "Personal Synthetic Vault", {
        purpose: "vault-name",
        payloadType: "vault-name",
        keyVersion: 1,
      });
      const serverResponse: AuthorizedWorkspaceResponse = {
        responseVersion: 1,
        workspaceSynchronizationToken: "synthetic-workspace-sync",
        synchronizedAt: "2026-09-27T00:00:00.000Z",
        personalSnapshot: {
          schemaVersion: 3,
          profileId,
          synchronizedAt: "2026-09-27T00:00:00.000Z",
          synchronizationToken: "synthetic-personal-sync",
          cryptoProfile: {
            vaultUnlockSalt: bytesToBase64(salt),
            wrappedUserRootKey: wrappedRootKey,
            encryptedPersonalVaultKey: encryptedPersonalKey,
            encryptionVersion: 1,
          },
          personalVault: {
            vaultId: personalVaultId,
            lifecycle: "ACTIVE",
            encryptedName: encryptedPersonalName,
            encryptionVersion: 1,
            accounts: [],
          },
        },
        sharedVaults: [
          {
            vaultId: sharedVaultId,
            lifecycle: "ACTIVE",
            role: "VIEWER",
            effectiveAccountPermissions: {
              permissions: { canAddAccounts: false, canEditAccounts: false, canDeleteAccounts: false },
              sources: { canAddAccounts: "VAULT", canEditAccounts: "VAULT", canDeleteAccounts: "VAULT" },
            },
            encryptedName: sharedName,
            encryptionVersion: 1,
            encryptedVaultKey: encryptedSharedKey,
            keyVersion: 1,
            accounts: [],
          },
        ],
        userEncryptionIdentity: {
          publicKey: keyPair.publicKey,
          encryptedPrivateKey: bytesToBase64(legacyCiphertext),
          encryptionVersion: 1,
        },
      };
      const requests: PlatformHttpRequest[] = [];
      let migrationBody: Record<string, unknown> | undefined;
      let profileMigrationBody: Record<string, unknown> | undefined;
      let keyWrapMigrationBody: Record<string, unknown> | undefined;
      const transport: AuthenticatedTransport = {
        request: async (request) => {
          requests.push(request);
          if (request.method === "GET") return response(200, serverResponse);
          if (typeof request.body !== "string") throw new Error("Unexpected native workspace request.");
          const body = object(JSON.parse(request.body));
          if (request.url === `/v1/shared-vaults/${sharedVaultId}/key-wrap/migration`) {
            keyWrapMigrationBody = body;
            if (typeof body.replacementCiphertext !== "string") throw new Error("Missing member key-wrap ciphertext.");
            serverResponse.sharedVaults[0]!.encryptedVaultKey = body.replacementCiphertext;
            return response(204, {});
          }
          if (request.url === "/v1/user-crypto-profile/migration") {
            profileMigrationBody = body;
            const wrapper = object(body.encryptedPersonalVaultKey);
            if (typeof wrapper.expectedCiphertext !== "string" || typeof wrapper.replacementCiphertext !== "string")
              throw new Error("Missing profile wrapper migration ciphertext.");
            if (serverResponse.personalSnapshot.cryptoProfile.encryptedPersonalVaultKey !== wrapper.expectedCiphertext)
              return response(409, {});
            serverResponse.personalSnapshot.cryptoProfile.encryptedPersonalVaultKey = wrapper.replacementCiphertext;
            return response(204, {});
          }
          if (request.url !== "/v1/user-encryption-identity/migration")
            throw new Error("Unexpected native workspace request.");
          migrationBody = body;
          if (typeof body.encryptedPrivateKey !== "string") throw new Error("Missing replacement ciphertext.");
          if (!serverResponse.userEncryptionIdentity) throw new Error("Missing legacy identity.");
          serverResponse.userEncryptionIdentity.encryptedPrivateKey = body.encryptedPrivateKey;
          return response(204, {});
        },
      };
      const mobilePorts = createMobileVaultWorkspacePorts(transport);
      const persistedSnapshots: EncryptedPersonalOfflineSnapshot[] = [];
      const snapshotStore = {
        listProfiles: async () => ({ profiles: [], migrationRequired: false }),
        read: async () => null,
        readByPersonalVaultId: async () => null,
        replace: async (snapshot: EncryptedPersonalOfflineSnapshot) => {
          persistedSnapshots.push(snapshot);
        },
        removeVault: async () => undefined,
        removeProfile: async () => undefined,
        clearAll: async () => undefined,
      };
      const ports: VaultWorkspacePlatformPorts = {
        ...mobilePorts,
        data: { ...mobilePorts.data, snapshotStore },
        crypto: {
          ...mobilePorts.crypto,
          unlockPersonalVault: async () => ({
            userRootKey: userRootKey.slice(),
            personalVaultKey: personalVaultKey.slice(),
          }),
        },
      };

      let firstWorkspace: Awaited<ReturnType<typeof loadUnlockedVaultWorkspace>> | undefined;
      let refreshedWorkspace: Awaited<ReturnType<typeof refreshUnlockedVaultWorkspace>> | undefined;
      let secondRefreshedWorkspace: Awaited<ReturnType<typeof refreshUnlockedVaultWorkspace>> | undefined;
      let secondWorkspace: Awaited<ReturnType<typeof loadUnlockedVaultWorkspace>> | undefined;
      try {
        firstWorkspace = await loadUnlockedVaultWorkspace("synthetic passphrase", personalVaultId, ports);
        expect(firstWorkspace.vaults.map(({ name }) => name)).toEqual([
          "Personal Synthetic Vault",
          "Shared Synthetic Vault",
        ]);
        expect(firstWorkspace.unavailableSharedVaults).toBe(0);
        expect(requests.filter(({ method }) => method === "POST")).toHaveLength(2);
        expect(keyWrapMigrationBody).toEqual(expect.objectContaining({ replacementEnvelopeVersion: 2 }));
        expect(migrationBody).toEqual(expect.objectContaining({ replacementEnvelopeVersion: 2 }));
        expect(migrationBody).not.toHaveProperty("plaintext");
        expect(migrationBody).not.toHaveProperty("privateKey");
        expect(keyWrapMigrationBody).not.toHaveProperty("plaintext");
        expect(keyWrapMigrationBody).not.toHaveProperty("vaultKey");
        const committedSharedKeyBytes = base64ToBytes(serverResponse.sharedVaults[0]!.encryptedVaultKey);
        const committedSharedKey = nativeClientCrypto.deserializeKeyWrapEnvelope(committedSharedKeyBytes);
        try {
          expect(committedSharedKey.version).toBe(2);
          expect(committedSharedKey.nonce).not.toEqual(sharedKeyPackage.nonce);
        } finally {
          committedSharedKeyBytes.fill(0);
          committedSharedKey.nonce.fill(0);
          committedSharedKey.ciphertext.fill(0);
        }
        const committedCiphertext = base64ToBytes(serverResponse.userEncryptionIdentity!.encryptedPrivateKey);
        const committedEnvelope = nativeClientCrypto.deserializeEncryptedEnvelope(committedCiphertext);
        try {
          expect(committedEnvelope.version).toBe(2);
          expect(committedEnvelope.nonce).not.toEqual(legacyEnvelope.nonce);
        } finally {
          committedCiphertext.fill(0);
          committedEnvelope.nonce.fill(0);
          committedEnvelope.ciphertext.fill(0);
        }
        expect(persistedSnapshots).toHaveLength(1);
        expect(persistedSnapshots[0]).not.toHaveProperty("userEncryptionIdentity");
        clearUnlockedVaultWorkspace(firstWorkspace);
        firstWorkspace = undefined;

        refreshedWorkspace = await refreshUnlockedVaultWorkspace(userRootKey, profileId, ports);
        expect(refreshedWorkspace.vaults.map(({ name }) => name)).toEqual([
          "Personal Synthetic Vault",
          "Shared Synthetic Vault",
        ]);
        expect(requests.filter(({ method }) => method === "POST")).toHaveLength(3);
        expect(profileMigrationBody).toEqual(
          expect.objectContaining({ encryptedPersonalVaultKey: expect.any(Object) }),
        );
        expect(profileMigrationBody).not.toHaveProperty("plaintext");
        expect(profileMigrationBody).not.toHaveProperty("personalVaultKey");
        const migratedPersonalKeyBytes = base64ToBytes(
          serverResponse.personalSnapshot.cryptoProfile.encryptedPersonalVaultKey,
        );
        const migratedPersonalKeyEnvelope = nativeClientCrypto.deserializeEncryptedEnvelope(migratedPersonalKeyBytes);
        try {
          expect(migratedPersonalKeyEnvelope.version).toBe(2);
          expect(migratedPersonalKeyEnvelope.nonce).not.toEqual(legacyPersonalKeyEnvelope.nonce);
        } finally {
          migratedPersonalKeyBytes.fill(0);
          migratedPersonalKeyEnvelope.nonce.fill(0);
          migratedPersonalKeyEnvelope.ciphertext.fill(0);
        }
        clearUnlockedVaultWorkspace(refreshedWorkspace);
        refreshedWorkspace = undefined;

        secondRefreshedWorkspace = await refreshUnlockedVaultWorkspace(userRootKey, profileId, ports);
        expect(requests.filter(({ url }) => url.endsWith("/key-wrap/migration"))).toHaveLength(1);
        expect(requests.filter(({ method }) => method === "POST")).toHaveLength(3);
        clearUnlockedVaultWorkspace(secondRefreshedWorkspace);
        secondRefreshedWorkspace = undefined;

        secondWorkspace = await loadUnlockedVaultWorkspace("synthetic passphrase", personalVaultId, ports);
        expect(secondWorkspace.vaults.map(({ name }) => name)).toEqual([
          "Personal Synthetic Vault",
          "Shared Synthetic Vault",
        ]);
        expect(secondWorkspace.unavailableSharedVaults).toBe(0);
        expect(requests.filter(({ method }) => method === "GET")).toHaveLength(4);
        expect(requests.filter(({ method }) => method === "POST")).toHaveLength(3);
      } finally {
        if (firstWorkspace) clearUnlockedVaultWorkspace(firstWorkspace);
        if (refreshedWorkspace) clearUnlockedVaultWorkspace(refreshedWorkspace);
        if (secondRefreshedWorkspace) clearUnlockedVaultWorkspace(secondRefreshedWorkspace);
        if (secondWorkspace) clearUnlockedVaultWorkspace(secondWorkspace);
        userRootKey.fill(0);
        personalVaultKey.fill(0);
        unlockKey.fill(0);
        sharedVaultKey.fill(0);
        salt.fill(0);
        privateKeyPlaintext.fill(0);
        legacyEnvelope.nonce.fill(0);
        legacyEnvelope.ciphertext.fill(0);
        legacyCiphertext.fill(0);
        legacyPersonalKeyEnvelope.nonce.fill(0);
        legacyPersonalKeyEnvelope.ciphertext.fill(0);
        encryptedPersonalKeyBytes.fill(0);
        sharedKeyPackage.nonce.fill(0);
        sharedKeyPackage.ciphertext.fill(0);
        serializedSharedKeyPackage.fill(0);
        Reflect.set(keyPair.privateKey, "x", "");
        Reflect.set(keyPair.privateKey, "y", "");
        Reflect.set(keyPair.privateKey, "d", "");
      }
    });
  });

  it("migrates a legacy identity on-device and sends only opaque replacement ciphertext", async () => {
    const transport = new StubTransport(response(204, {}));
    const ports = createMobileVaultWorkspacePorts(transport);
    const userRootKey = new Uint8Array(32).fill(61);
    const keyPair = await nativeClientCrypto.generateUserEncryptionKeyPair();
    const originalPublicKey = { ...keyPair.publicKey };
    const plaintext = new TextEncoder().encode(JSON.stringify(keyPair.privateKey));
    const legacyEnvelope = await nativeClientCrypto.encryptPayload(userRootKey, plaintext);
    const legacyCiphertext = nativeClientCrypto.serializeEncryptedEnvelope(legacyEnvelope);

    const recoveredPrivateKey = await ports.crypto.recoverOrMigratePrivateKey(
      userRootKey,
      legacyCiphertext,
      keyPair.publicKey,
      1,
    );

    expect(recoveredPrivateKey).toEqual(keyPair.privateKey);
    expect(keyPair.publicKey).toEqual(originalPublicKey);
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]).toMatchObject({
      url: "/v1/user-encryption-identity/migration",
      method: "POST",
      cache: "no-store",
    });
    const requestBody = transport.requests[0]?.body;
    if (typeof requestBody !== "string") throw new Error("Migration request body must be JSON text.");
    const body: unknown = JSON.parse(requestBody);
    expect(body).toMatchObject({
      expectedEnvelopeVersion: 1,
      replacementEnvelopeVersion: 2,
      userEncryptionKeyVersion: 1,
      encryptedPrivateKey: expect.any(String),
      expectedCiphertextDigest: expect.any(String),
      replacementCiphertextDigest: expect.any(String),
      operationId: expect.any(String),
    });
    expect(body).not.toHaveProperty("plaintext");
    expect(body).not.toHaveProperty("privateKey");

    Reflect.set(recoveredPrivateKey, "x", "");
    Reflect.set(recoveredPrivateKey, "y", "");
    Reflect.set(recoveredPrivateKey, "d", "");
    Reflect.set(keyPair.privateKey, "x", "");
    Reflect.set(keyPair.privateKey, "y", "");
    Reflect.set(keyPair.privateKey, "d", "");
    userRootKey.fill(0);
    plaintext.fill(0);
    legacyEnvelope.nonce.fill(0);
    legacyEnvelope.ciphertext.fill(0);
    legacyCiphertext.fill(0);
  });
});

class StubTransport implements AuthenticatedTransport {
  public readonly requests: PlatformHttpRequest[] = [];
  public constructor(private readonly result: PlatformHttpResponse) {}
  public async request(request: PlatformHttpRequest): Promise<PlatformHttpResponse> {
    this.requests.push(request);
    return this.result;
  }
}

async function encryptContext(
  key: Uint8Array,
  plaintext: Uint8Array | string,
  context: Parameters<typeof nativeClientCrypto.encryptPayloadWithContext>[2],
): Promise<string> {
  const bytes = typeof plaintext === "string" ? new TextEncoder().encode(plaintext) : plaintext;
  const envelope = await nativeClientCrypto.encryptPayloadWithContext(key, bytes, context);
  let serialized: Uint8Array | undefined;
  try {
    serialized = nativeClientCrypto.serializeEncryptedEnvelope(envelope);
    return bytesToBase64(serialized);
  } finally {
    envelope.nonce.fill(0);
    envelope.ciphertext.fill(0);
    serialized?.fill(0);
    if (typeof plaintext === "string") bytes.fill(0);
  }
}

async function withUniqueNativeRandom<T>(operation: () => Promise<T>): Promise<T> {
  let call = 0;
  const random = jest.spyOn(nativeCryptoPrimitives, "randomBytes").mockImplementation((length) => {
    const start = (call++ * 37 + 1) & 0xff;
    return Uint8Array.from({ length }, (_, index) => (start + index) & 0xff);
  });
  try {
    return await operation();
  } finally {
    random.mockRestore();
  }
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected JSON object.");
  const record: Record<string, unknown> = {};
  for (const key of Object.keys(value)) record[key] = Reflect.get(value, key);
  return record;
}

function response(status: number, body: unknown, headers: Record<string, string> = {}): PlatformHttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async <Value>() => body as Value,
    bytes: async () => new Uint8Array(),
    text: async () => JSON.stringify(body),
  };
}

function workspaceResponse() {
  return {
    responseVersion: 1,
    workspaceSynchronizationToken: "sync-token-1",
    synchronizedAt: "2026-08-11T22:00:00.000Z",
    personalSnapshot: {
      schemaVersion: 3,
      profileId: "profile_1",
      synchronizedAt: "2026-08-11T22:00:00.000Z",
      synchronizationToken: "personal-token-1",
      cryptoProfile: {
        vaultUnlockSalt: bytesToBase64(new Uint8Array(16).fill(1)),
        wrappedUserRootKey: envelope(2),
        encryptedPersonalVaultKey: envelope(3),
        encryptionVersion: 1,
      },
      personalVault: {
        vaultId: "vault_1",
        lifecycle: "ACTIVE",
        encryptedName: envelope(4),
        encryptionVersion: 1,
        accounts: [],
      },
    },
    sharedVaults: [],
  };
}

function envelope(fill: number): string {
  const bytes = new Uint8Array(29).fill(fill);
  bytes[0] = 2;
  return bytesToBase64(bytes);
}
