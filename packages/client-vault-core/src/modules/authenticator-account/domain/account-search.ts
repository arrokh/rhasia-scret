export type AccountSearchFields = { issuer: string; accountName: string };

export function matchesAuthenticatorAccountSearch(account: AccountSearchFields, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  return (
    !normalizedQuery ||
    account.issuer.toLowerCase().includes(normalizedQuery) ||
    account.accountName.toLowerCase().includes(normalizedQuery)
  );
}
