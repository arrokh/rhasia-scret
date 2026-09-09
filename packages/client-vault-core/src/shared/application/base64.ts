const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    output += ALPHABET[first >> 2];
    output += ALPHABET[((first & 3) << 4) | (second === undefined ? 0 : second >> 4)];
    output += second === undefined ? "=" : ALPHABET[((second & 15) << 2) | (third === undefined ? 0 : third >> 6)];
    output += third === undefined ? "=" : ALPHABET[third & 63];
  }
  return output;
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new Error("Invalid Base64 data.");
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array((value.length / 4) * 3 - padding);
  let outputIndex = 0;
  for (let index = 0; index < value.length; index += 4) {
    const first = decodeChar(value[index]);
    const second = decodeChar(value[index + 1]);
    const third = value[index + 2] === "=" ? 0 : decodeChar(value[index + 2]);
    const fourth = value[index + 3] === "=" ? 0 : decodeChar(value[index + 3]);
    if (outputIndex < bytes.length) bytes[outputIndex++] = (first << 2) | (second >> 4);
    if (outputIndex < bytes.length) bytes[outputIndex++] = ((second & 15) << 4) | (third >> 2);
    if (outputIndex < bytes.length) bytes[outputIndex++] = ((third & 3) << 6) | fourth;
  }
  return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return base64ToBytes(normalized);
}

function decodeChar(value: string): number {
  const decoded = ALPHABET.indexOf(value);
  if (decoded < 0) throw new Error("Invalid Base64 data.");
  return decoded;
}
