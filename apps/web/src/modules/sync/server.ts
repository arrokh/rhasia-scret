import { PrismaOfflineSyncBundleReader } from "./infrastructure/prisma-offline-sync-bundle-reader";

export type { OfflineSyncBundleReader } from "./application/offline-sync-bundle-reader";

export function createOfflineSyncBundleReader(): PrismaOfflineSyncBundleReader {
  return new PrismaOfflineSyncBundleReader();
}
