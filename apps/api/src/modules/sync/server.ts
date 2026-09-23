import { PrismaOfflineSyncBundleReader } from "./infrastructure/prisma-offline-sync-bundle-reader";
import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";

export type { AuthorizedWorkspaceReader } from "./application/authorized-workspace-reader";
export type { OfflineSyncBundleReader } from "./application/offline-sync-bundle-reader";

export function createOfflineSyncBundleReader(database: PrismaDatabase): PrismaOfflineSyncBundleReader {
  return new PrismaOfflineSyncBundleReader(database);
}

export function createAuthorizedWorkspaceReader(database: PrismaDatabase): PrismaOfflineSyncBundleReader {
  return new PrismaOfflineSyncBundleReader(database);
}
