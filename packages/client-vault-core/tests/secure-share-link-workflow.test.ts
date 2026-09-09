import { describe, expect, it, vi } from "vitest";
import {
  createSecureShareLink,
  createSecureShareLinkMaterialWithCrypto,
  redeemSecureShareLinkMaterialWithCrypto,
  type ClientCryptoPort,
  type SecureShareLinkCreationPorts,
  type SecureShareLinkMaterial,
  type SecureShareLinkCreationTransportPort,
} from "../src/index";

describe("Secure Share Link creation workflow", () => {
  it("owns creation sequencing and keeps the client secret out of transport", async () => {
    const material = shareMaterial();
    const transport = new FakeTransport();
    const delivered: string[] = [];
    const ports: SecureShareLinkCreationPorts = {
      crypto: { createMaterial: async () => material },
      transport,
      delivery: {
        deliver: async ({ secret }) => {
          delivered.push(secret);
        },
      },
    };

    await expect(createSecureShareLink("vault-1", " Viewer@Example.Test ", new Uint8Array(32), ports)).resolves.toEqual(
      {
        id: "invitation-1",
        secret: "client-only-secret",
        expiresAt: "2026-08-05T12:00:00.000Z",
      },
    );
    expect(delivered).toEqual(["client-only-secret"]);
    expect(transport.created?.recipientEmail).toBe(" Viewer@Example.Test ");
    expect(transport.created?.linkVerifier).not.toContain("client-only-secret");
    expect(transport.created?.encryptedPackage).not.toContain("client-only-secret");
    expect(material.linkVerifier).toEqual(new Uint8Array(32));
    expect(material.encryptedPackage).toEqual(new Uint8Array(13));
    expect(material.secret).toBe("");
  });

  it("revokes a created invitation when platform delivery fails and clears temporary bytes", async () => {
    const material = shareMaterial();
    const transport = new FakeTransport();
    transport.cancelError = new Error("cancel unavailable");
    const ports: SecureShareLinkCreationPorts = {
      crypto: { createMaterial: async () => material },
      transport,
      delivery: {
        deliver: async () => {
          throw new Error("delivery cancelled");
        },
      },
    };

    await expect(createSecureShareLink("vault-1", "recipient@example.test", new Uint8Array(32), ports)).rejects.toThrow(
      "delivery cancelled",
    );
    expect(transport.cancelled).toEqual(["vault-1/invitation-1"]);
    expect(material.linkVerifier).toEqual(new Uint8Array(32));
    expect(material.encryptedPackage).toEqual(new Uint8Array(13));
    expect(material.secret).toBe("");
  });

  it("clears the verifier when share material preparation fails after hashing it", async () => {
    const linkVerifier = new Uint8Array(32).fill(1);
    let digestCalls = 0;
    const digest = async (): Promise<Uint8Array> => {
      digestCalls += 1;
      if (digestCalls === 1) return linkVerifier;
      throw new Error("digest failed");
    };
    const crypto = { generateSymmetricKey: () => new Uint8Array(32).fill(7) } as unknown as ClientCryptoPort;

    await expect(
      createSecureShareLinkMaterialWithCrypto(new Uint8Array(32), "vault-1", crypto, digest),
    ).rejects.toThrow("digest failed");
    expect(linkVerifier).toEqual(new Uint8Array(32));
  });

  it("clears the verifier and derived link key when link redemption fails", async () => {
    const linkVerifier = new Uint8Array(32).fill(1);
    const linkKey = new Uint8Array(32).fill(2);
    let digestCalls = 0;
    const digest = async (): Promise<Uint8Array> => {
      digestCalls += 1;
      return digestCalls === 1 ? linkVerifier : linkKey;
    };
    const crypto = {
      deserializeEncryptedEnvelope: vi.fn(() => ({
        version: 2,
        nonce: new Uint8Array(12),
        ciphertext: new Uint8Array(16),
      })),
      decryptPayloadWithContext: vi.fn(async () => {
        throw new Error("authentication failed");
      }),
    } as unknown as ClientCryptoPort;

    await expect(
      redeemSecureShareLinkMaterialWithCrypto(
        "client-secret",
        new Uint8Array(29),
        new Uint8Array(32),
        "vault-1",
        crypto,
        digest,
      ),
    ).rejects.toThrow("authentication failed");
    expect(linkVerifier).toEqual(new Uint8Array(32));
    expect(linkKey).toEqual(new Uint8Array(32));
  });
});

function shareMaterial(): SecureShareLinkMaterial {
  return {
    secret: "client-only-secret",
    linkVerifier: new Uint8Array(32).fill(1),
    encryptedPackage: new Uint8Array(13).fill(2),
  };
}

class FakeTransport implements SecureShareLinkCreationTransportPort {
  public created: { recipientEmail: string; linkVerifier: string; encryptedPackage: string } | undefined;
  public readonly cancelled: string[] = [];
  public cancelError: Error | undefined;

  async create(
    _vaultId: string,
    request: { recipientEmail: string; linkVerifier: string; encryptedPackage: string },
  ): Promise<{ id: string; expiresAt: string }> {
    this.created = request;
    return { id: "invitation-1", expiresAt: "2026-08-05T12:00:00.000Z" };
  }

  async lookup(): Promise<never> {
    throw new Error("unused");
  }

  async redeem(): Promise<void> {
    throw new Error("unused");
  }

  async cancel(vaultId: string, invitationId: string): Promise<void> {
    this.cancelled.push(`${vaultId}/${invitationId}`);
    if (this.cancelError) throw this.cancelError;
  }
}
