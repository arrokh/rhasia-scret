import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTH_RETURN_PATH,
  INVITATION_AUTH_RETURN_PATH,
  resolveAuthReturnPath,
} from "@/modules/identity/application/auth-return-path";

describe("auth return path", () => {
  it("allows the invitation redemption path", () => {
    expect(resolveAuthReturnPath(INVITATION_AUTH_RETURN_PATH)).toBe(INVITATION_AUTH_RETURN_PATH);
  });

  it.each([undefined, null, "", "https://attacker.example", "/vaults?next=https://attacker.example"])(
    "falls back to the vault directory for an unsafe path (%s)",
    (value) => {
      expect(resolveAuthReturnPath(value)).toBe(DEFAULT_AUTH_RETURN_PATH);
    },
  );
});
