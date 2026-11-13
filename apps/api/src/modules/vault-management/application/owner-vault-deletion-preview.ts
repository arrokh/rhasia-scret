export type OwnerVaultDeletionPreview = Readonly<{
  personalVaultId: string | null;
  ownedSharedVaults: readonly Readonly<{
    id: string;
    lifecycle: string;
    viewerCandidates: readonly Readonly<{ id: string; email: string }>[];
  }>[];
}>;

export interface OwnerVaultDeletionPreviewRepository {
  getForOwner(ownerId: string): Promise<OwnerVaultDeletionPreview>;
}

export function getOwnerVaultDeletionPreview(
  ownerId: string,
  repository: OwnerVaultDeletionPreviewRepository,
): Promise<OwnerVaultDeletionPreview> {
  return repository.getForOwner(ownerId);
}
