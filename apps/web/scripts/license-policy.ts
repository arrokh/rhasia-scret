const prohibitedIdentifier = /(?:^|\b)(?:AGPL|GPL|SSPL|UNLICENSED|UNKNOWN)(?:\b|$)/i;

/** SPDX OR expressions are selectable alternatives; every alternative must be prohibited to reject the package. */
export function isProhibitedLicense(expression: string): boolean {
  return expression.split(/\s+OR\s+/i).every((alternative) => prohibitedIdentifier.test(alternative));
}
