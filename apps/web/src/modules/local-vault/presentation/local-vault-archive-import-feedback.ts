export type LocalVaultArchiveImportFeedback =
  { tone: "warning"; message: "noNewAccounts" } | { tone: "success"; message: "imported"; count: number };

export function localVaultArchiveImportFeedback(count: number): LocalVaultArchiveImportFeedback {
  if (count === 0) return { tone: "warning", message: "noNewAccounts" };
  return { tone: "success", message: "imported", count };
}
