/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ createSecureShareLinkMaterial: vi.fn() }));
vi.mock("@/modules/vault-membership/infrastructure/browser-secure-share-link", () => ({ createSecureShareLinkMaterial: mocks.createSecureShareLinkMaterial }));
import { createSharedVaultInvitation } from "@/modules/vault-membership/infrastructure/browser-shared-vault-invitation";

describe("createSharedVaultInvitation", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("sends only recipient identity and encrypted one-time material to the server", async () => {
    const vaultKey = new Uint8Array(32).fill(9);
    mocks.createSecureShareLinkMaterial.mockResolvedValue({ secret: "client-only-secret", linkVerifier: new Uint8Array(32).fill(1), encryptedPackage: new Uint8Array(13).fill(2) });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: "invitation-1", expiresAt: "2026-08-05T12:00:00.000Z" }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(createSharedVaultInvitation("vault-1", " Viewer@Example.Test ", vaultKey)).resolves.toEqual({ id: "invitation-1", secret: "client-only-secret", expiresAt: "2026-08-05T12:00:00.000Z" });

    expect(mocks.createSecureShareLinkMaterial).toHaveBeenCalledWith(vaultKey, "vault-1");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toEqual({ recipientEmail: "viewer@example.test", linkVerifier: expect.any(String), encryptedPackage: expect.any(String) });
    expect(JSON.stringify(body)).not.toContain("client-only-secret");
    expect(JSON.stringify(body)).not.toContain(Array.from(vaultKey).join(","));
  });
});
