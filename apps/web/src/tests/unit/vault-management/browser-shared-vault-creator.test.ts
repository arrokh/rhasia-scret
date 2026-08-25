import { describe, expect, it } from "vitest";
import { generateSymmetricKey } from "@/modules/crypto";
import { createSharedVaultMaterial } from "@/modules/vault-management/infrastructure/browser-shared-vault-creator";

describe("createSharedVaultMaterial", () => {
  it("creates a random vault key and only encrypted server-bound material", async () => {
    const material = await createSharedVaultMaterial(generateSymmetricKey(), "Family");
    expect(material.vaultKey).toHaveLength(32);
    expect(material.encryptedName).not.toEqual(new TextEncoder().encode("Family"));
    expect(material.encryptedOwnerVaultKey).toHaveLength(61);
  });
});
