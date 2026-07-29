import type { CursorPage, CursorPageRequest } from "@/shared/application/cursor-page";
import type {
  EffectiveSharedVaultAccountPermissions,
  SharedVaultAccountPermissionOverrides,
  SharedVaultAccountPermissions
} from "../domain/shared-vault-account-permissions";

export type VaultParticipant = {
  key: string;
  email: string;
  kind: "OWNER" | "MEMBER" | "INVITATION";
  userId: string | null;
  invitationId: string | null;
  invitationState: "PENDING" | "EXPIRED" | null;
  invitedAt: Date;
  expiresAt: Date | null;
  permissionOverrides: SharedVaultAccountPermissionOverrides | null;
  effectiveAccountPermissions: EffectiveSharedVaultAccountPermissions | null;
  permissionsRevision: number | null;
};

export type VaultParticipantPage = CursorPage<VaultParticipant> & {
  owner: { id: string; email: string };
  vaultDefaultAccountPermissions: SharedVaultAccountPermissions;
  vaultDefaultAccountPermissionsRevision: number;
};

export type VaultParticipantCursorKey = { kind: "MEMBER" | "INVITATION"; id: string };

export function parseVaultParticipantCursorKey(key: string): VaultParticipantCursorKey | null {
  const match = /^(member|invitation):(.+)$/.exec(key);
  if (!match) return null;
  return { kind: match[1] === "member" ? "MEMBER" : "INVITATION", id: match[2]! };
}

export interface VaultParticipantRepository {
  listForOwner(ownerId: string, vaultId: string, request: CursorPageRequest): Promise<VaultParticipantPage | null>;
  cancelInvitation(ownerId: string, vaultId: string, invitationId: string): Promise<boolean>;
}
