/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

import { OwnedSharedVaultResetBlocker } from "@/modules/vault-management/presentation/owned-shared-vault-reset-blocker";
import { TestQueryProvider } from "@/tests/test-query-provider";

describe("OwnedSharedVaultResetBlocker", () => {
  let root: Root | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("soft-deletes an owned Shared Vault before destructive Personal Vault reset", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => root?.render(createElement(TestQueryProvider, null, createElement(OwnedSharedVaultResetBlocker, { vaultIds: ["shared-1"] }))));
    await act(async () => container.querySelector<HTMLButtonElement>(".owned-vault-reset-list .danger-button")?.click());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Hapus Brankas Bersama?");
    await act(async () => container.querySelector<HTMLButtonElement>(".confirmation-dialog .danger-button")?.click());

    expect(fetchMock).toHaveBeenCalledWith("/api/shared-vaults/shared-1/lifecycle", { method: "DELETE" });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Semua anggota akan langsung kehilangan akses");
  });
});
