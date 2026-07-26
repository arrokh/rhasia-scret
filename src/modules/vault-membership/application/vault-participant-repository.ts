export type VaultParticipant = {
  key: string;
  email: string;
  kind: "OWNER" | "MEMBER" | "INVITATION";
  userId: string | null;
  invitationId: string | null;
  invitedAt: Date | null;
};

export interface VaultParticipantRepository {
  listForOwner(ownerId: string, vaultId: string): Promise<VaultParticipant[] | null>;
  cancelInvitation(ownerId: string, vaultId: string, invitationId: string): Promise<boolean>;
}
