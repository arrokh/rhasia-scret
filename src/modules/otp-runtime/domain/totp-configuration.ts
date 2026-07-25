export type TotpAlgorithm = "SHA-1" | "SHA-256" | "SHA-512";

export type TotpConfiguration = {
  issuer: string;
  accountName: string;
  secret: Uint8Array;
  algorithm: TotpAlgorithm;
  digits: 6 | 8;
  period: number;
};

export function parseTotpUri(uri: string): TotpConfiguration {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new Error("The authenticator URI is invalid.");
  }
  if (url.protocol !== "otpauth:" || url.hostname !== "totp") {
    throw new Error("Only otpauth://totp configurations are supported.");
  }
  const secret = url.searchParams.get("secret");
  if (!secret) throw new Error("The authenticator URI has no secret.");
  const { issuer: labelIssuer, accountName } = parseLabel(url.pathname);
  const issuer = url.searchParams.get("issuer") ?? labelIssuer;
  if (!issuer) throw new Error("The authenticator URI has no issuer.");
  if (labelIssuer && issuer !== labelIssuer) throw new Error("The issuer label and parameter must match.");
  const algorithm = parseAlgorithm(url.searchParams.get("algorithm") ?? "SHA1");
  const digits = parseDigits(url.searchParams.get("digits") ?? "6");
  const period = parsePeriod(url.searchParams.get("period") ?? "30");
  return { issuer, accountName, secret: decodeBase32(secret), algorithm, digits, period };
}

function parseLabel(pathname: string): { issuer?: string; accountName: string } {
  const label = decodeURIComponent(pathname.replace(/^\//, ""));
  if (!label) throw new Error("The authenticator URI has no account label.");
  const separator = label.indexOf(":");
  if (separator === -1) return { accountName: label };
  const issuer = label.slice(0, separator).trim();
  const accountName = label.slice(separator + 1).trim();
  if (!issuer || !accountName) throw new Error("The authenticator URI label is invalid.");
  return { issuer, accountName };
}

function parseAlgorithm(value: string): TotpAlgorithm {
  const normalized = value.replace(/-/g, "").toUpperCase();
  if (normalized === "SHA1") return "SHA-1";
  if (normalized === "SHA256") return "SHA-256";
  if (normalized === "SHA512") return "SHA-512";
  throw new Error("The authenticator URI uses an unsupported algorithm.");
}

function parseDigits(value: string): 6 | 8 {
  if (value === "6") return 6;
  if (value === "8") return 8;
  throw new Error("The authenticator URI uses unsupported digits.");
}

function parsePeriod(value: string): number {
  const period = Number(value);
  if (!Number.isSafeInteger(period) || period <= 0) throw new Error("The authenticator URI period is invalid.");
  return period;
}

function decodeBase32(value: string): Uint8Array {
  const normalized = value.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (!/^[A-Z2-7]+$/.test(normalized)) throw new Error("The authenticator URI secret is invalid.");
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
