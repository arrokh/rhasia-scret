import { Prisma } from "@prisma/client";
import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";
import { sha256Digest, toBase64Url } from "@api/shared/infrastructure/crypto";
import type {
  EncryptedUserCryptoProfile,
  UserCryptoProfileMigration,
  UserCryptoProfileMigrationResult,
  UserCryptoProfileRepository,
  UserCryptoProfileWrapperMigration,
  UserEncryptionIdentity,
  UserEncryptionPrivateKeyMigration,
  UserEncryptionPrivateKeyMigrationResult,
  UserRootKeyRewrap,
} from "../application/user-crypto-profile-repository";

export class PrismaUserCryptoProfileRepository implements UserCryptoProfileRepository {
  public constructor(private readonly database: PrismaDatabase) {}
  public async get(userId: string): Promise<EncryptedUserCryptoProfile | null> {
    const profile = await this.database.userCryptoProfile.findUnique({ where: { userId } });
    if (!profile) return null;
    return {
      vaultUnlockSalt: copyBytes(profile.vaultUnlockSalt),
      wrappedUserRootKey: copyBytes(profile.wrappedUserRootKey),
      encryptedPersonalVaultKey: copyBytes(profile.encryptedPersonalVaultKey),
      encryptionVersion: profile.rootKeyWrappingVersion,
      userEncryptionPublicKey: profile.userEncryptionPublicKey
        ? (profile.userEncryptionPublicKey as JsonWebKey)
        : undefined,
      encryptedUserPrivateKey: profile.encryptedUserPrivateKey ? copyBytes(profile.encryptedUserPrivateKey) : undefined,
    };
  }

  public async registerUserEncryptionIdentity(userId: string, identity: UserEncryptionIdentity): Promise<boolean> {
    return this.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      const updated = await tx.userCryptoProfile.updateMany({
        where: {
          userId,
          userEncryptionPublicKey: { equals: Prisma.DbNull },
          encryptedUserPrivateKey: null,
          userEncryptionKeyVersion: null,
        },
        data: {
          userEncryptionPublicKey: identity.publicKey as Prisma.InputJsonValue,
          encryptedUserPrivateKey: copyBytes(identity.encryptedPrivateKey),
          userEncryptionKeyVersion: identity.encryptionVersion,
        },
      });
      if (updated.count === 1) return true;
      const profile = await tx.userCryptoProfile.findUnique({ where: { userId }, select: { userId: true } });
      if (!profile) throw new Error("User crypto profile does not exist.");
      return false;
    });
  }

  public async migrateUserEncryptionPrivateKey(
    userId: string,
    migration: UserEncryptionPrivateKeyMigration,
  ): Promise<UserEncryptionPrivateKeyMigrationResult> {
    const replacement = copyBytes(migration.encryptedPrivateKey);
    try {
      if (
        replacement[0] !== migration.replacementEnvelopeVersion ||
        migration.replacementEnvelopeVersion !== 2 ||
        migration.expectedEnvelopeVersion !== 1
      )
        return "conflict";
      const replacementDigest = digestString(replacement);
      if (replacementDigest !== migration.replacementCiphertextDigest || migration.operationId !== replacementDigest)
        return "conflict";

      return await this.database.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
        const profile = await tx.userCryptoProfile.findUnique({
          where: { userId },
          select: { encryptedUserPrivateKey: true, userEncryptionKeyVersion: true },
        });
        if (
          !profile?.encryptedUserPrivateKey ||
          profile.userEncryptionKeyVersion !== migration.userEncryptionKeyVersion
        )
          return "conflict";
        const current = copyBytes(profile.encryptedUserPrivateKey);
        try {
          if (bytesEqual(current, replacement)) return "already-committed";
          if (
            current[0] !== migration.expectedEnvelopeVersion ||
            digestString(current) !== migration.expectedCiphertextDigest
          )
            return "conflict";
          const updated = await tx.userCryptoProfile.updateMany({
            where: {
              userId,
              encryptedUserPrivateKey: copyBytes(current),
              userEncryptionKeyVersion: migration.userEncryptionKeyVersion,
            },
            data: { encryptedUserPrivateKey: copyBytes(replacement) },
          });
          return updated.count === 1 ? "committed" : "conflict";
        } finally {
          current.fill(0);
        }
      });
    } finally {
      replacement.fill(0);
    }
  }

  public async migrateUserCryptoProfile(
    userId: string,
    migration: UserCryptoProfileMigration,
  ): Promise<UserCryptoProfileMigrationResult> {
    const wrappedReplacement = migration.wrappedUserRootKey
      ? copyBytes(migration.wrappedUserRootKey.replacementCiphertext)
      : undefined;
    const personalKeyReplacement = migration.encryptedPersonalVaultKey
      ? copyBytes(migration.encryptedPersonalVaultKey.replacementCiphertext)
      : undefined;
    if (
      (!migration.wrappedUserRootKey && !migration.encryptedPersonalVaultKey) ||
      !validProfileWrapperMigration(migration.wrappedUserRootKey) ||
      !validProfileWrapperMigration(migration.encryptedPersonalVaultKey)
    ) {
      wrappedReplacement?.fill(0);
      personalKeyReplacement?.fill(0);
      return "conflict";
    }

    try {
      return await this.database.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
        const profile = await tx.userCryptoProfile.findUnique({
          where: { userId },
          select: { wrappedUserRootKey: true, encryptedPersonalVaultKey: true },
        });
        if (!profile) return "conflict";
        const currentWrapped = migration.wrappedUserRootKey ? copyBytes(profile.wrappedUserRootKey) : undefined;
        const currentPersonalKey = migration.encryptedPersonalVaultKey
          ? copyBytes(profile.encryptedPersonalVaultKey)
          : undefined;
        try {
          const wrappedState = profileWrapperMigrationState(
            currentWrapped,
            migration.wrappedUserRootKey,
            wrappedReplacement,
          );
          const personalKeyState = profileWrapperMigrationState(
            currentPersonalKey,
            migration.encryptedPersonalVaultKey,
            personalKeyReplacement,
          );
          if (wrappedState === "conflict" || personalKeyState === "conflict") return "conflict";
          if (wrappedState !== "replace" && personalKeyState !== "replace") return "already-committed";
          const updated = await tx.userCryptoProfile.updateMany({
            where: {
              userId,
              ...(currentWrapped ? { wrappedUserRootKey: currentWrapped } : {}),
              ...(currentPersonalKey ? { encryptedPersonalVaultKey: currentPersonalKey } : {}),
            },
            data: {
              ...(wrappedState === "replace" ? { wrappedUserRootKey: wrappedReplacement } : {}),
              ...(personalKeyState === "replace" ? { encryptedPersonalVaultKey: personalKeyReplacement } : {}),
            },
          });
          return updated.count === 1 ? "committed" : "conflict";
        } finally {
          currentWrapped?.fill(0);
          currentPersonalKey?.fill(0);
        }
      });
    } finally {
      wrappedReplacement?.fill(0);
      personalKeyReplacement?.fill(0);
    }
  }

  public async rewrapUserRootKey(userId: string, rewrap: UserRootKeyRewrap): Promise<void> {
    await this.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      const updated = await tx.userCryptoProfile.updateMany({
        where: { userId },
        data: {
          vaultUnlockSalt: copyBytes(rewrap.vaultUnlockSalt),
          wrappedUserRootKey: copyBytes(rewrap.wrappedUserRootKey),
          rootKeyWrappingVersion: rewrap.encryptionVersion,
          ...(rewrap.encryptedPersonalVaultKey
            ? {
                encryptedPersonalVaultKey: copyBytes(rewrap.encryptedPersonalVaultKey),
                personalVaultKeyEncryptionVersion: rewrap.encryptionVersion,
              }
            : {}),
        },
      });
      if (updated.count !== 1) throw new Error("User crypto profile does not exist.");
    });
  }
}

function validProfileWrapperMigration(migration?: UserCryptoProfileWrapperMigration): boolean {
  return (
    migration === undefined ||
    (migration.expectedCiphertext.length >= 30 &&
      migration.replacementCiphertext.length >= 30 &&
      migration.expectedCiphertext[0] === 1 &&
      migration.replacementCiphertext[0] === 2)
  );
}

function profileWrapperMigrationState(
  current: Uint8Array | undefined,
  migration: UserCryptoProfileWrapperMigration | undefined,
  replacement: Uint8Array | undefined,
): "replace" | "already-committed" | "conflict" | undefined {
  if (!current || !migration || !replacement) return undefined;
  if (bytesEqual(current, replacement)) return "already-committed";
  if (bytesEqual(current, migration.expectedCiphertext)) return "replace";
  return "conflict";
}

function digestString(bytes: Uint8Array): string {
  const digest = sha256Digest(bytes);
  try {
    return toBase64Url(digest);
  } finally {
    digest.fill(0);
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}
