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
    document.body.innerHTML = "";
  });

  it("soft-deletes an owned Shared Vault after shadcn confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        createElement(TestQueryProvider, null, createElement(OwnedSharedVaultResetBlocker, { vaultIds: ["shared-1"] })),
      ),
    );
    const remove = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Hapus brankas"),
    );
    await act(async () => remove?.click());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Hapus Brankas Bersama?");
    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Hapus brankas" && button.closest('[role="dialog"]'),
    );
    await act(async () => confirm?.click());
    expect(fetchMock).toHaveBeenCalledWith("/api/shared-vaults/shared-1/lifecycle", { method: "DELETE" });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Semua anggota akan langsung kehilangan akses");
  });
});
