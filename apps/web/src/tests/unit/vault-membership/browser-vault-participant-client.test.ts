/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { loadVaultParticipants } from "@/modules/vault-membership/infrastructure/browser-vault-participant-client";

describe("loadVaultParticipants", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests an encoded cursor and preserves page metadata", async () => {
    const page = { owner: { id: "owner-1", email: "owner@example.test" }, participants: [], nextCursor: null };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => page });
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadVaultParticipants("vault/1", "opaque cursor")).resolves.toEqual(page);
    expect(fetchMock).toHaveBeenCalledWith("/api/shared-vaults/vault%2F1/participants?cursor=opaque+cursor", {
      cache: "no-store",
      method: "GET",
    });
  });
});
