import { prisma } from "@/shared/infrastructure/prisma-client";
import type { EncryptedUserCryptoProfile, UserCryptoProfileRepository, UserRootKeyRewrap } from "../application/user-crypto-profile-repository";

export class PrismaUserCryptoProfileRepository implements UserCryptoProfileRepository {
  public async get(userId: string): Promise<EncryptedUserCryptoProfile | null> {
    const profile = await prisma.userCryptoProfile.findUnique({ where: { userId } });
    if (!profile) return null;
    return {
      vaultUnlockSalt: copyBytes(profile.vaultUnlockSalt),
      wrappedUserRootKey: copyBytes(profile.wrappedUserRootKey),
      encryptedPersonalVaultKey: copyBytes(profile.encryptedPersonalVaultKey),
      encryptionVersion: profile.rootKeyWrappingVersion
    };
  }

  public async rewrapUserRootKey(userId: string, rewrap: UserRootKeyRewrap): Promise<void> {
    const updated = await prisma.userCryptoProfile.updateMany({
      where: { userId },
      data: {
        vaultUnlockSalt: copyBytes(rewrap.vaultUnlockSalt),
        wrappedUserRootKey: copyBytes(rewrap.wrappedUserRootKey),
        rootKeyWrappingVersion: rewrap.encryptionVersion
      }
    });
    if (updated.count !== 1) throw new Error("User crypto profile does not exist.");
  }
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}
