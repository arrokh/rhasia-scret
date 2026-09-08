export type TotpAlgorithm = "SHA-1" | "SHA-256" | "SHA-512";
export type TotpConfigurationErrorCode = "invalidUri" | "totpOnly" | "missingSecret" | "missingIssuer" | "issuerMismatch" | "invalidLabel" | "missingAccount" | "unsupportedAlgorithm" | "unsupportedDigits" | "invalidPeriod" | "invalidSecret";

export class TotpConfigurationError extends Error {
  public constructor(public readonly code: TotpConfigurationErrorCode) {
    super(`Invalid TOTP configuration: ${code}.`);
    this.name = "TotpConfigurationError";
  }
}

export type TotpConfiguration = {
  issuer: string;
  accountName: string;
  secret: Uint8Array;
  algorithm: TotpAlgorithm;
  digits: 6 | 8;
  period: number;
};

const MAX_BASE32_SECRET_INPUT_LENGTH = 1024;

export function parseTotpUri(uri: string): TotpConfiguration {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new TotpConfigurationError("invalidUri");
  }
  if (url.protocol !== "otpauth:" || url.hostname !== "totp") {
    throw new TotpConfigurationError("totpOnly");
  }
  const secret = url.searchParams.get("secret");
  if (!secret) throw new TotpConfigurationError("missingSecret");
  const { issuer: labelIssuer, accountName } = parseLabel(url.pathname);
  const issuer = url.searchParams.get("issuer") ?? labelIssuer;
  if (!issuer) throw new TotpConfigurationError("missingIssuer");
  if (labelIssuer && issuer !== labelIssuer) throw new TotpConfigurationError("issuerMismatch");
  const algorithm = parseAlgorithm(url.searchParams.get("algorithm") ?? "SHA1");
  const digits = parseDigits(url.searchParams.get("digits") ?? "6");
  const period = parsePeriod(url.searchParams.get("period") ?? "30");
  return { issuer, accountName, secret: decodeBase32(secret), algorithm, digits, period };
}

function parseLabel(pathname: string): { issuer?: string; accountName: string } {
  let label: string;
  try {
    label = decodeURIComponent(pathname.replace(/^\//, ""));
  } catch {
    throw new TotpConfigurationError("invalidLabel");
  }
  if (!label) throw new TotpConfigurationError("missingAccount");
  const separator = label.indexOf(":");
  if (separator === -1) return { accountName: label };
  const issuer = label.slice(0, separator).trim();
  const accountName = label.slice(separator + 1).trim();
  if (!issuer || !accountName) throw new TotpConfigurationError("invalidLabel");
  return { issuer, accountName };
}

function parseAlgorithm(value: string): TotpAlgorithm {
  const normalized = value.replace(/-/g, "").toUpperCase();
  if (normalized === "SHA1") return "SHA-1";
  if (normalized === "SHA256") return "SHA-256";
  if (normalized === "SHA512") return "SHA-512";
  throw new TotpConfigurationError("unsupportedAlgorithm");
}

function parseDigits(value: string): 6 | 8 {
  if (value === "6") return 6;
  if (value === "8") return 8;
  throw new TotpConfigurationError("unsupportedDigits");
}

function parsePeriod(value: string): number {
  const period = Number(value);
  if (!Number.isSafeInteger(period) || period <= 0) throw new TotpConfigurationError("invalidPeriod");
  return period;
}

function decodeBase32(value: string): Uint8Array {
  if (value.length > MAX_BASE32_SECRET_INPUT_LENGTH) throw new TotpConfigurationError("invalidSecret");
  const normalized = value.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (!/^[A-Z2-7]+$/.test(normalized)) throw new TotpConfigurationError("invalidSecret");
  let bits = 0;
  let bitCount = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    bits = (bits << 5) | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(character);
    bitCount += 5;
    if (bitCount >= 8) {
      bytes.push((bits >>> (bitCount - 8)) & 0xff);
      bitCount -= 8;
    }
  }
  return new Uint8Array(bytes);
}
