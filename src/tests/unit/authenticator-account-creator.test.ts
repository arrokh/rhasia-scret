/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mocks = vi.hoisted(() => ({
  encryptAccountConfiguration: vi.fn(),
  isDuplicateAccount: vi.fn(),
  loadUnlockedVaultWorkspace: vi.fn(),
  parseTotpUri: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn()
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("@/shared/presentation/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("@/modules/otp-runtime", () => ({ parseTotpUri: mocks.parseTotpUri }));
vi.mock("@/modules/authenticator-account/infrastructure/browser-account-payload", () => ({
  encryptAccountConfiguration: mocks.encryptAccountConfiguration,
  isDuplicateAccount: mocks.isDuplicateAccount
}));
vi.mock("@/modules/authenticator-account/infrastructure/browser-vault-workspace", () => ({
  loadUnlockedVaultWorkspace: mocks.loadUnlockedVaultWorkspace
}));
vi.mock("@/modules/authenticator-account/presentation/qr-import-input", () => ({ QrImportInput: () => null }));

import { AuthenticatorAccountCreator } from "@/modules/authenticator-account/presentation/authenticator-account-creator";
import { UnlockedVaultWorkspaceProvider } from "@/modules/authenticator-account/presentation/unlocked-vault-workspace-provider";
import { TestQueryProvider } from "@/tests/test-query-provider";

describe("AuthenticatorAccountCreator", () => {
  let root: Root | undefined;
  afterEach(async () => {
    vi.unstubAllGlobals();
    await act(async () => root?.unmount());
  });

  it("preselects the Shared Vault requested from its management modal", async () => {
    const sessionWorkspace = {
      userRootKey: new Uint8Array(32),
      vaults: [
        { id: "personal-1", name: "Brankas Pribadi", type: "PERSONAL" as const, role: "OWNER" as const, key: new Uint8Array(32) },
        { id: "shared-1", name: "Tim Operasional", type: "SHARED" as const, role: "OWNER" as const, key: new Uint8Array(32) }
      ],
      accounts: [],
      unavailableSharedVaults: 0
    };
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => root?.render(createElement(TestQueryProvider, null,
      createElement(UnlockedVaultWorkspaceProvider, { initialWorkspace: sessionWorkspace },
        createElement(AuthenticatorAccountCreator, { personalVaultId: "personal-1", preferredVaultId: "shared-1" })
      )
    )));

    expect(container.querySelector<HTMLSelectElement>("#account-target-vault")?.value).toBe("shared-1");
    expect(container.querySelector("#account-vault-unlock-secret")).toBeNull();
  });

  it("unlocks, selects an owned Shared Vault, encrypts locally, and posts from the dedicated page", async () => {
    const candidate = { issuer: "Example", accountName: "person@example.test", secret: Uint8Array.of(1), algorithm: "SHA-1", digits: 6, period: 30 };
    const sharedKey = Uint8Array.of(8);
    mocks.loadUnlockedVaultWorkspace.mockResolvedValue({
      userRootKey: Uint8Array.of(7),
      vaults: [
        { id: "personal-1", name: "Brankas Pribadi", type: "PERSONAL", role: "OWNER", key: Uint8Array.of(6) },
        { id: "shared-1", name: "Tim Operasional", type: "SHARED", role: "OWNER", key: sharedKey }
      ],
      accounts: []
    });
    mocks.parseTotpUri.mockReturnValue(candidate);
    mocks.isDuplicateAccount.mockReturnValue(false);
    mocks.encryptAccountConfiguration.mockResolvedValue(Uint8Array.from([1, 2, 3]));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "new-account", revision: 1 }) });
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(TestQueryProvider, null,
      createElement(UnlockedVaultWorkspaceProvider, null, createElement(AuthenticatorAccountCreator, { personalVaultId: "personal-1" }))
    )));

    await act(async () => {
      setInputValue(container.querySelector("#account-vault-unlock-secret"), "four random secret words");
    });
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());

    const target = container.querySelector<HTMLSelectElement>("#account-target-vault");
    await act(async () => {
      setSelectValue(target, "shared-1");
      setInputValue(container.querySelector("#account-uri"), "otpauth://totp/Example:person@example.test?secret=JBSWY3DPEHPK3PXP&issuer=Example");
    });
    expect(container.textContent).toContain("Metadata autentikator");
    expect(container.textContent).toContain("SHA-1");
    expect(container.textContent).toContain("30 detik");
    expect(container.querySelector<HTMLInputElement>("#account-label")?.value).toBe("person@example.test");
    await act(async () => setInputValue(container.querySelector("#account-label"), "Alice Mobile"));
    await act(async () => container.querySelector<HTMLFormElement>(".add-account-form")?.requestSubmit());

    expect(mocks.encryptAccountConfiguration).toHaveBeenCalledWith(sharedKey, { ...candidate, accountName: "Alice Mobile" });
    expect(fetchMock).toHaveBeenCalledWith("/api/shared-vaults/shared-1/accounts", expect.objectContaining({ method: "POST" }));
    expect(mocks.push).toHaveBeenCalledWith("/vaults");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
});

function setInputValue(input: HTMLInputElement | null, value: string) {
  if (!input) throw new Error("Expected input.");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function setSelectValue(select: HTMLSelectElement | null, value: string) {
  if (!select) throw new Error("Expected select.");
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}
