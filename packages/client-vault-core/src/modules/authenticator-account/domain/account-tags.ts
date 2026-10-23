export const MAX_AUTHENTICATOR_ACCOUNT_TAGS = 20;
export const MAX_AUTHENTICATOR_ACCOUNT_TAG_CODE_POINTS = 32;

export type AccountTagValidationErrorCode =
  "notArray" | "tooMany" | "notString" | "empty" | "tooLong" | "controlCharacter" | "duplicate";

export class AccountTagValidationError extends Error {
  public constructor(public readonly code: AccountTagValidationErrorCode) {
    super(code);
  }
}

export function matchesAuthenticatorAccountTagFilter(
  accountTags: readonly string[] | undefined,
  selectedTags: readonly string[],
): boolean {
  return selectedTags.length === 0 || selectedTags.some((tag) => accountTags?.includes(tag));
}

export function normalizeAuthenticatorAccountTags(value: unknown): string[] {
  if (!Array.isArray(value)) throw new AccountTagValidationError("notArray");
  if (value.length > MAX_AUTHENTICATOR_ACCOUNT_TAGS) throw new AccountTagValidationError("tooMany");

  const tags: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") throw new AccountTagValidationError("notString");
    const tag = entry.trim();
    if (!tag) throw new AccountTagValidationError("empty");
    if ([...tag].length > MAX_AUTHENTICATOR_ACCOUNT_TAG_CODE_POINTS) throw new AccountTagValidationError("tooLong");
    if (/[\u0000-\u001f\u007f-\u009f]/u.test(tag)) throw new AccountTagValidationError("controlCharacter");
    const duplicateKey = tag.toLowerCase();
    if (seen.has(duplicateKey)) throw new AccountTagValidationError("duplicate");
    seen.add(duplicateKey);
    tags.push(tag);
  }
  return tags;
}
