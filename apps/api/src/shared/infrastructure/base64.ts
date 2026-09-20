export type Buffer = ApiBuffer;

export const Buffer = {
  from(
    value: string | ArrayBuffer | ArrayLike<number> | ArrayBufferView,
    encoding?: "base64" | "base64url" | "utf8",
  ): ApiBuffer {
    if (typeof value === "string") {
      if (!encoding || encoding === "utf8") return new ApiBuffer(new TextEncoder().encode(value));
      return new ApiBuffer(decodeBase64(value, encoding === "base64url"));
    }
    if (value instanceof ArrayBuffer) return new ApiBuffer(new Uint8Array(value));
    if (ArrayBuffer.isView(value))
      return new ApiBuffer(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return new ApiBuffer(value);
  },
  byteLength(value: string, encoding: "base64" | "base64url" | "utf8" = "utf8"): number {
    return Buffer.from(value, encoding).byteLength;
  },
};

export class ApiBuffer extends Uint8Array {
  public equals(other: Uint8Array): boolean {
    if (this.length !== other.length) return false;
    let difference = 0;
    for (let index = 0; index < this.length; index += 1) difference |= this[index] ^ other[index];
    return difference === 0;
  }

  public toString(encoding: "base64" | "base64url" | "utf8" = "utf8"): string {
    if (encoding === "utf8") return new TextDecoder().decode(this);
    return encodeBase64(this, encoding === "base64url");
  }
}

function decodeBase64(value: string, urlSafe: boolean): Uint8Array {
  const normalized = urlSafe ? value.replace(/-/g, "+").replace(/_/g, "/") : value;
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64(value: Uint8Array, urlSafe: boolean): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  const encoded = btoa(binary);
  return urlSafe ? encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "") : encoded;
}
