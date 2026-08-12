import { ARGON2ID_PROTOCOL_VECTOR } from "../../../../src/modules/crypto/application/protocol-test-vectors";
import {
  NativeArgon2idPort,
  type NativeArgon2idDriver,
  type NativeArgon2idRequest,
} from "./native-argon2id";

const parameters = {
  memoryKiB: ARGON2ID_PROTOCOL_VECTOR.memoryKiB,
  iterations: ARGON2ID_PROTOCOL_VECTOR.iterations,
  parallelism: ARGON2ID_PROTOCOL_VECTOR.parallelism,
  outputBytes: ARGON2ID_PROTOCOL_VECTOR.outputBytes,
};

describe("NativeArgon2idPort", () => {
  it("maps the shared protocol parameters to binary native derivation", async () => {
    let request: NativeArgon2idRequest | undefined;
    const driver: NativeArgon2idDriver = {
      derive: async (value) => {
        request = value;
        return hexToBytes(ARGON2ID_PROTOCOL_VECTOR.expectedHex);
      },
    };
    const port = new NativeArgon2idPort(driver);

    const key = await port.deriveArgon2id(
      ARGON2ID_PROTOCOL_VECTOR.secret,
      ARGON2ID_PROTOCOL_VECTOR.salt,
      parameters,
    );

    expect(bytesToHex(key)).toBe(ARGON2ID_PROTOCOL_VECTOR.expectedHex);
    expect(request).toMatchObject({
      password: ARGON2ID_PROTOCOL_VECTOR.secret,
      iterations: ARGON2ID_PROTOCOL_VECTOR.iterations,
      memorySize: ARGON2ID_PROTOCOL_VECTOR.memoryKiB,
      parallelism: ARGON2ID_PROTOCOL_VECTOR.parallelism,
      hashLength: ARGON2ID_PROTOCOL_VECTOR.outputBytes,
      outputType: "binary",
    });
    expect(request?.salt).toEqual(new Uint8Array(16));
    key.fill(0);
  });

  it("fails before native derivation when cancellation is already requested", async () => {
    const derive = jest.fn<ReturnType<NativeArgon2idDriver["derive"]>, Parameters<NativeArgon2idDriver["derive"]>>();
    const port = new NativeArgon2idPort({ derive });

    await expect(port.deriveArgon2id(
      ARGON2ID_PROTOCOL_VECTOR.secret,
      ARGON2ID_PROTOCOL_VECTOR.salt,
      parameters,
      { aborted: true, subscribe: () => () => undefined },
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(derive).not.toHaveBeenCalled();
  });
});

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string): Uint8Array {
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}
