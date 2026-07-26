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
    throw new Error("URI autentikator tidak valid.");
  }
  if (url.protocol !== "otpauth:" || url.hostname !== "totp") {
    throw new Error("Hanya konfigurasi otpauth://totp yang didukung.");
  }
  const secret = url.searchParams.get("secret");
  if (!secret) throw new Error("URI autentikator tidak memiliki rahasia.");
  const { issuer: labelIssuer, accountName } = parseLabel(url.pathname);
  const issuer = url.searchParams.get("issuer") ?? labelIssuer;
  if (!issuer) throw new Error("URI autentikator tidak memiliki penerbit.");
  if (labelIssuer && issuer !== labelIssuer) throw new Error("Label dan parameter penerbit harus sama.");
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
    throw new Error("Label URI autentikator tidak valid.");
  }
  if (!label) throw new Error("URI autentikator tidak memiliki label akun.");
  const separator = label.indexOf(":");
  if (separator === -1) return { accountName: label };
  const issuer = label.slice(0, separator).trim();
  const accountName = label.slice(separator + 1).trim();
  if (!issuer || !accountName) throw new Error("Label URI autentikator tidak valid.");
  return { issuer, accountName };
}

function parseAlgorithm(value: string): TotpAlgorithm {
  const normalized = value.replace(/-/g, "").toUpperCase();
  if (normalized === "SHA1") return "SHA-1";
  if (normalized === "SHA256") return "SHA-256";
  if (normalized === "SHA512") return "SHA-512";
  throw new Error("URI autentikator menggunakan algoritme yang tidak didukung.");
}

function parseDigits(value: string): 6 | 8 {
  if (value === "6") return 6;
  if (value === "8") return 8;
  throw new Error("URI autentikator menggunakan jumlah digit yang tidak didukung.");
}

function parsePeriod(value: string): number {
  const period = Number(value);
  if (!Number.isSafeInteger(period) || period <= 0) throw new Error("Periode URI autentikator tidak valid.");
  return period;
}

function decodeBase32(value: string): Uint8Array {
  const normalized = value.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (!/^[A-Z2-7]+$/.test(normalized)) throw new Error("Rahasia URI autentikator tidak valid.");
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
