import { describe, expect, it } from "vitest";
import { generateSymmetricKey } from "@/modules/crypto";
import { createSecureShareLinkMaterial } from "@/modules/vault-membership";

describe("createSecureShareLinkMaterial", () => {
  it("creates a one-time secret verifier and opaque encrypted vault-key package", async () => {
    const vaultKey = generateSymmetricKey();
    const material = await createSecureShareLinkMaterial(vaultKey);
    expect(material.secret).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(material.linkVerifier).toHaveLength(32);
    expect(material.encryptedPackage).not.toEqual(vaultKey);
  });
});
