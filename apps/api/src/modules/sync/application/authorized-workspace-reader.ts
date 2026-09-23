import type { AuthorizedWorkspaceResponse } from "@rhasia-scret/client-vault-core/modules/sync/domain/offline-vault-bundle";

export interface AuthorizedWorkspaceReader {
  readAuthorizedWorkspaceResponse(userId: string): Promise<AuthorizedWorkspaceResponse | null>;
}
