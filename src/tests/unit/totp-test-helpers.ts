export function rfcTotpUri(overrides = ""): string {
  const url = new URL("otpauth://totp/Example:alice");
  url.searchParams.set("secret", base32(new TextEncoder().encode("12345678901234567890")));
  url.searchParams.set("issuer", "Example");
  for (const [name, value] of new URLSearchParams(overrides)) url.searchParams.set(name, value);
  return url.toString();
}

function base32(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let value = 0;
  let bits = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}
