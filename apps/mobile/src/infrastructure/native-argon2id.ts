import { argon2id } from "../../modules/native-argon2id";
import type {
  Argon2idParameters,
  KeyDerivationPort,
} from "@rhasia-scret/client-vault-core";
import type { CancellationPort } from "@rhasia-scret/client-vault-core";

const maximumMemoryKiB = 256 * 1_024;
const maximumOutputBytes = 64;

export type NativeArgon2idRequest = {
  password: string;
  salt: Uint8Array;
  iterations: number;
  memorySize: number;
  parallelism: number;
  hashLength: number;
  outputType: "binary";
};

export interface NativeArgon2idDriver {
  derive(request: NativeArgon2idRequest): Promise<Uint8Array>;
}

const expoArgon2idDriver: NativeArgon2idDriver = {
  derive: (request) => argon2id(request),
};

/** Runs the protocol KDF in native background code, outside the React Native JS thread. */
export class NativeArgon2idPort implements KeyDerivationPort {
  public constructor(private readonly driver: NativeArgon2idDriver = expoArgon2idDriver) {}

  public async deriveArgon2id(
    secret: string,
    salt: Uint8Array,
    parameters: Argon2idParameters,
    signal?: CancellationPort,
  ): Promise<Uint8Array> {
    validateRequest(secret, salt, parameters);
    throwIfCancelled(signal);
    const copiedSalt = salt.slice();
    let key: Uint8Array | undefined;
    try {
      key = await this.driver.derive({
        password: secret.normalize("NFKC"),
        salt: copiedSalt,
        iterations: parameters.iterations,
        memorySize: parameters.memoryKiB,
        parallelism: parameters.parallelism,
        hashLength: parameters.outputBytes,
        outputType: "binary",
      });
      if (!(key instanceof Uint8Array) || key.length !== parameters.outputBytes) {
        key?.fill(0);
        throw new Error("Argon2id did not return valid binary key material.");
      }
      if (signal?.aborted) {
        key.fill(0);
        throw cancellationError();
      }
      return key;
    } finally {
      copiedSalt.fill(0);
    }
  }
}

export const nativeArgon2idPort = new NativeArgon2idPort();

function validateRequest(secret: string, salt: Uint8Array, parameters: Argon2idParameters): void {
  if (secret.trim().length < 3) throw new Error("A Vault Unlock Secret must contain at least three characters.");
  if (salt.length !== 16) throw new Error("A 16-byte Vault Unlock salt is required.");
  if (!Number.isSafeInteger(parameters.memoryKiB) || parameters.memoryKiB < 8 || parameters.memoryKiB > maximumMemoryKiB) {
    throw new Error("Argon2id memory parameters are invalid.");
  }
  if (!Number.isSafeInteger(parameters.iterations) || parameters.iterations < 1 || parameters.iterations > 10) {
    throw new Error("Argon2id iteration parameters are invalid.");
  }
  if (!Number.isSafeInteger(parameters.parallelism) || parameters.parallelism < 1 || parameters.parallelism > 4) {
    throw new Error("Argon2id parallelism parameters are invalid.");
  }
  if (!Number.isSafeInteger(parameters.outputBytes) || parameters.outputBytes < 16 || parameters.outputBytes > maximumOutputBytes) {
    throw new Error("Argon2id output parameters are invalid.");
  }
}

function throwIfCancelled(signal?: CancellationPort): void {
  if (signal?.aborted) throw cancellationError();
}

function cancellationError(): Error {
  const error = new Error("Vault Unlock Key derivation was cancelled.");
  error.name = "AbortError";
  return error;
}
