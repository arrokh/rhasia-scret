import { gcm } from "@noble/ciphers/aes.js";
import { p256 } from "@noble/curves/nist.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha1 } from "@noble/hashes/legacy.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { randomBytes as nativeRandomBytes } from "../../modules/native-argon2id";
import type {
  CryptoPrimitivePort,
  PortableEcdhKeyPair,
  PortableJsonWebKey,
} from "@rhasia-scret/client-vault-core";
import { base64UrlToBytes, bytesToBase64Url } from "@rhasia-scret/client-vault-core";

const aesKeyBytes = 32;
const aesNonceBytes = 12;
const aesTagBytes = 16;
const p256CoordinateBytes = 32;

type P256PublicJwk = PortableJsonWebKey & {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
};

type P256PrivateJwk = P256PublicJwk & { d: string };

/** Native cryptographic primitives that preserve the web protocol's byte formats. */
export class NativeCryptoPrimitives implements CryptoPrimitivePort {
  public randomBytes(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || length > 1_024) {
      throw new Error("Random byte length is invalid.");
    }
    return nativeRandomBytes(length);
  }

  public async encryptAesGcm(request: {
    key: Uint8Array;
    nonce: Uint8Array;
    plaintext: Uint8Array;
    additionalData?: Uint8Array;
  }): Promise<Uint8Array> {
    validateAesRequest(request.key, request.nonce);
    return gcm(request.key, request.nonce, request.additionalData).encrypt(request.plaintext);
  }

  public async decryptAesGcm(request: {
    key: Uint8Array;
    nonce: Uint8Array;
    ciphertext: Uint8Array;
    additionalData?: Uint8Array;
  }): Promise<Uint8Array> {
    validateAesRequest(request.key, request.nonce);
    if (request.ciphertext.length < aesTagBytes) throw new Error("Encrypted envelope authentication failed.");
    try {
      return gcm(request.key, request.nonce, request.additionalData).decrypt(request.ciphertext);
    } catch {
      throw new Error("Encrypted envelope authentication failed.");
    }
  }

  public async generateEcdhKeyPair(): Promise<PortableEcdhKeyPair> {
    let privateBytes: Uint8Array;
    do {
      privateBytes = this.randomBytes(p256CoordinateBytes);
    } while (!p256.utils.isValidSecretKey(privateBytes));
    try {
      const publicBytes = p256.getPublicKey(privateBytes, false);
      const publicKey = publicJwk(publicBytes);
      return {
        publicKey,
        privateKey: {
          ...publicKey,
          d: bytesToBase64Url(privateBytes),
          key_ops: ["deriveBits"],
        },
      };
    } finally {
      privateBytes.fill(0);
    }
  }

  public async deriveEcdhSharedKey(privateKey: PortableJsonWebKey, publicKey: PortableJsonWebKey): Promise<Uint8Array> {
    const privateJwk = parsePrivateJwk(privateKey);
    const publicJwkValue = parsePublicJwk(publicKey);
    const privateBytes = base64UrlToBytes(privateJwk.d);
    const publicBytes = encodedPublicPoint(publicJwkValue);
    try {
      const sharedPoint = p256.getSharedSecret(privateBytes, publicBytes, false);
      return sharedPoint.slice(1, 1 + p256CoordinateBytes);
    } catch {
      throw new Error("ECDH key material is invalid.");
    } finally {
      privateBytes.fill(0);
    }
  }

  public async signHmac(
    algorithm: "SHA-1" | "SHA-256" | "SHA-512",
    key: Uint8Array,
    message: Uint8Array,
  ): Promise<Uint8Array> {
    const hash = algorithm === "SHA-1" ? sha1 : algorithm === "SHA-256" ? sha256 : sha512;
    return hmac(hash, key, message);
  }
}

export const nativeCryptoPrimitives = new NativeCryptoPrimitives();

function validateAesRequest(key: Uint8Array, nonce: Uint8Array): void {
  if (key.length !== aesKeyBytes) throw new Error("AES-256-GCM requires a 32-byte key.");
  if (nonce.length !== aesNonceBytes) throw new Error("AES-GCM requires a 12-byte nonce.");
}

function publicJwk(publicBytes: Uint8Array): P256PublicJwk {
  if (publicBytes.length !== 1 + 2 * p256CoordinateBytes || publicBytes[0] !== 4) {
    throw new Error("ECDH public key is invalid.");
  }
  return {
    kty: "EC",
    crv: "P-256",
    x: bytesToBase64Url(publicBytes.slice(1, 1 + p256CoordinateBytes)),
    y: bytesToBase64Url(publicBytes.slice(1 + p256CoordinateBytes)),
    ext: true,
    key_ops: [],
  };
}

function parsePublicJwk(value: PortableJsonWebKey): P256PublicJwk {
  if (value.kty !== "EC" || value.crv !== "P-256" || typeof value.x !== "string" || typeof value.y !== "string") {
    throw new Error("ECDH public key is invalid.");
  }
  const x = decodeCoordinate(value.x);
  const y = decodeCoordinate(value.y);
  x.fill(0);
  y.fill(0);
  return value as P256PublicJwk;
}

function parsePrivateJwk(value: PortableJsonWebKey): P256PrivateJwk {
  const publicKey = parsePublicJwk(value);
  if (typeof value.d !== "string") throw new Error("ECDH private key is invalid.");
  const privateBytes = decodeCoordinate(value.d);
  const valid = p256.utils.isValidSecretKey(privateBytes);
  privateBytes.fill(0);
  if (!valid) throw new Error("ECDH private key is invalid.");
  return { ...publicKey, d: value.d };
}

function encodedPublicPoint(value: P256PublicJwk): Uint8Array {
  const x = decodeCoordinate(value.x);
  const y = decodeCoordinate(value.y);
  const point = new Uint8Array(1 + 2 * p256CoordinateBytes);
  point[0] = 4;
  point.set(x, 1);
  point.set(y, 1 + p256CoordinateBytes);
  x.fill(0);
  y.fill(0);
  if (!p256.utils.isValidPublicKey(point)) throw new Error("ECDH public key is invalid.");
  return point;
}

function decodeCoordinate(value: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = base64UrlToBytes(value);
  } catch {
    throw new Error("ECDH key material is invalid.");
  }
  if (bytes.length !== p256CoordinateBytes) {
    bytes.fill(0);
    throw new Error("ECDH key material is invalid.");
  }
  return bytes;
}
