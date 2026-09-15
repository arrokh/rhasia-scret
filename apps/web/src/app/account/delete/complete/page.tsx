import { AccountDeletionCompletePage } from "@/modules/account-deletion";

export default async function AccountDeleteCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ receipt?: string; cleanup?: string }>;
}) {
  const params = await searchParams;
  const receiptId = params.receipt && /^[A-Za-z0-9_-]{16,128}$/.test(params.receipt) ? params.receipt : undefined;
  return <AccountDeletionCompletePage receiptId={receiptId} cleanupWarning={params.cleanup === "warning"} />;
}
