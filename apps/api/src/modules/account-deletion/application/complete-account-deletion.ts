import type { AccountDeletionEmailSender } from "./account-deletion-email";
import type { AccountDeletionRepository, AccountDeletionResult } from "./account-deletion-repository";
import type { AccountDeletionAuthBackend, AccountDeletionRequest } from "../domain/account-deletion-policy";

export type CompleteAccountDeletionDependencies = Readonly<{
  repository: AccountDeletionRepository;
  sender: Pick<AccountDeletionEmailSender, "sendDeletionCompletionEmail">;
  applicationUserId: string;
  authorizationToken: string;
  authBackend: AccountDeletionAuthBackend;
  request: AccountDeletionRequest;
  now: Date;
}>;

export type CompleteAccountDeletionResult = Readonly<{
  deletion: AccountDeletionResult;
  emailDelivery: "sent" | "failed";
}>;

/**
 * Coordinates the post-authorization deletion boundary. Database deletion is
 * committed first; completion email delivery is deliberately best-effort and
 * its outcome is persisted without allowing it to change the deletion result.
 */
export async function completeAccountDeletion(
  dependencies: CompleteAccountDeletionDependencies,
): Promise<CompleteAccountDeletionResult> {
  const deletion = await dependencies.repository.deleteUser(
    dependencies.applicationUserId,
    dependencies.authorizationToken,
    dependencies.authBackend,
    dependencies.request,
    dependencies.now,
  );

  try {
    await dependencies.sender.sendDeletionCompletionEmail({
      recipientEmail: deletion.email,
      receiptId: deletion.receiptId,
    });
    await dependencies.repository.recordCompletionEmailStatus(deletion.receiptId, "SENT");
    return { deletion, emailDelivery: "sent" };
  } catch {
    try {
      await dependencies.repository.recordCompletionEmailStatus(deletion.receiptId, "FAILED");
    } catch {
      // Deletion is already committed; status persistence is best-effort too.
    }
    return { deletion, emailDelivery: "failed" };
  }
}
