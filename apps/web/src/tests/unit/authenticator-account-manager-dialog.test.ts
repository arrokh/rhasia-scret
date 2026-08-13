/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
vi.mock("@/shared/presentation/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("@/modules/authenticator-account/infrastructure/browser-account-payload", () => ({
  encryptAccountConfiguration: vi.fn().mockResolvedValue(new Uint8Array(13).fill(1))
}));

import type { WorkspaceAuthenticatorAccount } from "@/modules/authenticator-account/infrastructure/browser-vault-workspace";
import { AuthenticatorAccountManagerDialog } from "@/modules/authenticator-account/presentation/authenticator-account-manager-dialog";
import { TestQueryProvider } from "@/tests/test-query-provider";

describe("AuthenticatorAccountManagerDialog", () => {
  let root: Root | undefined;
  afterEach(async () => {
    await act(async () => root?.unmount());
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("encrypts and revision-updates an edited account label", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "account-1", revision: 2 }) });
    vi.stubGlobal("fetch", fetchMock);
    const onUpdated = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await renderDialog(root, { onUpdated });

    await act(async () => setInputValue(document.body.querySelector("input"), "Alice Mobile"));
    await act(async () => document.body.querySelector<HTMLFormElement>("form")?.requestSubmit());

    expect(fetchMock).toHaveBeenCalledWith("/api/vaults/personal-1/accounts", expect.objectContaining({
      method: "PATCH",
      body: expect.stringContaining('"expectedRevision":1')
    }));
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ accountName: "Alice Mobile", revision: 2 }));
  });

  it("renders edit and delete capabilities independently", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await renderDialog(root, { canEdit: false, canDelete: true });

    expect(document.body.querySelector<HTMLInputElement>("input")?.disabled).toBe(true);
    expect([...document.body.querySelectorAll("button")].some((button) => button.textContent === "Simpan label")).toBe(false);
    expect(findButton(document.body, "Hapus akun")).toBeDefined();
  });

  it("requires a second modal confirmation before deleting", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const onDeleted = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await renderDialog(root, { onDeleted });

    await act(async () => findButton(document.body, "Hapus akun").click());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Hapus akun autentikator?");
    const confirmation = document.body.querySelectorAll('[role="dialog"]')[1] ?? document.body.querySelector('[role="alertdialog"]');
    await act(async () => findButton(confirmation ?? document.body, "Hapus akun").click());

    expect(fetchMock).toHaveBeenCalledWith("/api/vaults/personal-1/accounts", expect.objectContaining({ method: "DELETE" }));
    expect(onDeleted).toHaveBeenCalledWith(expect.objectContaining({ id: "account-1" }));
  });
});

async function renderDialog(root: Root, callbacks: { onUpdated?: (account: WorkspaceAuthenticatorAccount) => void; onDeleted?: (account: WorkspaceAuthenticatorAccount) => void; canEdit?: boolean; canDelete?: boolean }) {
  await act(async () => root.render(createElement(TestQueryProvider, null, createElement(AuthenticatorAccountManagerDialog, {
    account: {
      id: "account-1",
      vaultId: "personal-1",
      vaultName: "Brankas Pribadi",
      vaultType: "PERSONAL",
      revision: 1,
      issuer: "OTPAuth",
      accountName: "Alice",
      secret: Uint8Array.of(1),
      algorithm: "SHA-1",
      digits: 6,
      period: 30
    },
    vaultKey: new Uint8Array(32),
    canEdit: callbacks.canEdit,
    canDelete: callbacks.canDelete,
    onUpdated: callbacks.onUpdated ?? vi.fn(),
    onDeleted: callbacks.onDeleted ?? vi.fn(),
    onClose: vi.fn()
  }))));
}

function setInputValue(input: HTMLInputElement | null, value: string) {
  if (!input) throw new Error("Expected input.");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function findButton(container: Element | HTMLElement, name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === name);
  if (!button) throw new Error(`Expected button: ${name}`);
  return button;
}
