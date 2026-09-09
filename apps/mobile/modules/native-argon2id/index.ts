import { requireNativeModule } from "expo";

export type NativeArgon2idRequest = {
  password: string;
  salt: Uint8Array;
  iterations: number;
  memorySize: number;
  parallelism: number;
  hashLength: number;
  outputType: "binary";
};

type NativeModule = {
  randomBytes(length: number): Uint8Array;
  argon2id(request: {
    password: string;
    salt: string;
    iterations: number;
    memory: number;
    parallelism: number;
    hashLength: number;
  }): Promise<Uint8Array>;
};

const nativeModule = requireNativeModule<NativeModule>("ExpoCryptoArgon2");

export function randomBytes(length: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 0 || length > 1_024) throw new Error("Random byte length is invalid.");
  const bytes = nativeModule.randomBytes(length);
  if (!(bytes instanceof Uint8Array) || bytes.length !== length)
    throw new Error("Native random provider returned invalid bytes.");
  return bytes;
}

export async function argon2id(request: NativeArgon2idRequest): Promise<Uint8Array> {
  if (request.outputType !== "binary") throw new Error("Native Argon2id supports binary output only.");
  return nativeModule.argon2id({
    password: bytesToHex(new TextEncoder().encode(request.password)),
    salt: bytesToHex(request.salt),
    iterations: request.iterations,
    memory: request.memorySize,
    parallelism: request.parallelism,
    hashLength: request.hashLength,
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
