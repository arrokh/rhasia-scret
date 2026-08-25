/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/crypto", () => ({ hasRememberedBrowserForPersonalVault: vi.fn().mockResolvedValue(false) }));
vi.mock("@/modules/identity", () => ({ usePasskeyRecoveryStatusQuery: () => ({ data: { enrolled: false } }) }));

import { VaultWorkspaceUnlock } from "@/modules/authenticator-account/presentation/vault-workspace-unlock";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("locked Vault session", () => {
  it("offers the independent Local Vault as a separate touchpoint", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(createElement(VaultWorkspaceUnlock, { personalVaultId: "vault_test123", onUnlocked: vi.fn() })));

    const link = [...container.querySelectorAll("a")].find((candidate) => candidate.textContent === "Buka Brankas Lokal");
    expect(container.textContent).toContain("Brankas Anda terkunci");
    expect(container.textContent).toContain("Brankas Lokal independen");
    expect(link?.getAttribute("href")).toBe("/local");
  });
});
