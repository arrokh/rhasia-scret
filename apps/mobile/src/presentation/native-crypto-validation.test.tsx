import { render } from "@testing-library/react-native";
import { ARGON2ID_PROTOCOL_VECTOR } from "../../../../src/modules/crypto/application/protocol-test-vectors";
import { nativeArgon2idPort } from "../infrastructure/native-argon2id";
import { NativeCryptoValidation } from "./native-crypto-validation";

describe("NativeCryptoValidation", () => {
  afterEach(() => jest.restoreAllMocks());

  it("renders bilingual passing evidence for the shared synthetic vector", async () => {
    const expected = Uint8Array.from(ARGON2ID_PROTOCOL_VECTOR.expectedHex.match(/.{2}/g) ?? [], (value) => Number.parseInt(value, 16));
    jest.spyOn(nativeArgon2idPort, "deriveArgon2id").mockResolvedValue(expected);
    const screen = await render(<NativeCryptoValidation />);
    expect(await screen.findByText("LULUS / PASSED")).toBeVisible();
    expect(screen.getByRole("header", { name: "Validasi kriptografi native / Native cryptography validation" })).toBeVisible();
    expect([...expected]).toEqual(new Array(32).fill(0));
  });
});
