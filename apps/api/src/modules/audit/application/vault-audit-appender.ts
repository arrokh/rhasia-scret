import type { VaultAuditAppend } from "../domain/vault-audit-event";

/** Transaction-scoped port; callers append before their owning mutation commits. */
export interface VaultAuditAppender {
  append(event: VaultAuditAppend): Promise<void>;
}
