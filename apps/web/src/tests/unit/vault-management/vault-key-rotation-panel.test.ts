/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VaultKeyRotationPanel } from "@/modules/vault-management/presentation/vault-key-rotation-panel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const workflow = vi.hoisted(() => ({
  prepare: vi.fn(),
  submit: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock("@/modules/vault-management/infrastructure/browser-vault-key-rotation-workflow", () => ({
  prepareBrowserVaultKeyRotation: workflow.prepare,
  submitPreparedBrowserVaultKeyRotation: workflow.submit,
  reconcilePreparedBrowserVaultKeyRotation: workflow.reconcile,
}));

describe("VaultKeyRotationPanel", () => {
  let root: Root | undefined;
  afterEach(async () => {
    await act(async () => root?.unmount());
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("prepares locally, requires explicit confirmation, then refreshes after commit", async () => {
    workflow.prepare.mockResolvedValue({
      snapshot: {
        currentKeyVersion: 4,
        accounts: [{ id: "account-1", recoverableDeleted: true }],
        members: [{ userId: "owner-1" }],
        pendingInvitationCount: 1,
      },
      request: { keyVersion: 5 },
    });
    workflow.submit.mockResolvedValue("COMMITTED");
    const onRefresh = vi.fn(async () => undefined);
    const container = mount();
    root = createRoot(container);

    await act(async () =>
      root?.render(
        createElement(VaultKeyRotationPanel, {
          vaultId: "shared-1",
          vaultName: "Synthetic Team Vault",
          vaultKey: new Uint8Array(32),
          keyVersion: 4,
          onRefresh,
        }),
      ),
    );
    await act(async () => findButton(container, "Siapkan rotasi kunci Brankas").click());

    expect(workflow.prepare).toHaveBeenCalledWith("shared-1", expect.any(Uint8Array), 4, expect.any(AbortSignal));
    expect(container.textContent).toContain("Generasi kunci 4 akan menjadi 5");
    expect(container.textContent).toContain("1 catatan akun akan dienkripsi ulang");
    expect(workflow.submit).not.toHaveBeenCalled();

    await act(async () => findButton(container, "Tinjau rotasi").click());
    expect(document.body.textContent).toContain("Rotasikan Kunci Enkripsi Brankas ini?");
    await act(async () => findButton(document.body, "Rotasikan kunci Brankas").click());

    expect(workflow.submit).toHaveBeenCalledOnce();
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Kunci Enkripsi Brankas berhasil dirotasi");
  });

  it("reconciles an ambiguous submission before offering status recovery without resubmitting", async () => {
    workflow.prepare.mockResolvedValue({
      snapshot: { currentKeyVersion: 1, accounts: [], members: [], pendingInvitationCount: 0 },
      request: { keyVersion: 2 },
    });
    workflow.submit.mockResolvedValue("UNKNOWN");
    workflow.reconcile.mockResolvedValueOnce("UNKNOWN").mockResolvedValueOnce("COMMITTED");
    const onRefresh = vi.fn(async () => undefined);
    const container = mount();
    root = createRoot(container);

    await act(async () =>
      root?.render(
        createElement(VaultKeyRotationPanel, {
          vaultId: "shared-1",
          vaultName: "Synthetic Team Vault",
          vaultKey: new Uint8Array(32),
          keyVersion: 1,
          onRefresh,
        }),
      ),
    );
    await act(async () => findButton(container, "Siapkan rotasi kunci Brankas").click());
    await act(async () => findButton(container, "Tinjau rotasi").click());
    await act(async () => findButton(document.body, "Rotasikan kunci Brankas").click());

    expect(workflow.submit).toHaveBeenCalledOnce();
    expect(workflow.reconcile).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Hasil rotasi belum dapat diverifikasi");
    expect(findButton(container, "Periksa status rotasi")).toBeDefined();

    await act(async () => findButton(container, "Periksa status rotasi").click());
    expect(workflow.submit).toHaveBeenCalledOnce();
    expect(workflow.reconcile).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Kunci Enkripsi Brankas berhasil dirotasi");
  });

  it("cancels in-flight preparation and never submits its result", async () => {
    workflow.prepare.mockImplementation(
      (_vaultId: string, _vaultKey: Uint8Array, _keyVersion: number, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        }),
    );
    const container = mount();
    root = createRoot(container);

    await act(async () =>
      root?.render(
        createElement(VaultKeyRotationPanel, {
          vaultId: "shared-1",
          vaultName: "Synthetic Team Vault",
          vaultKey: new Uint8Array(32),
          keyVersion: 1,
          onRefresh: async () => undefined,
        }),
      ),
    );
    await act(async () => findButton(container, "Siapkan rotasi kunci Brankas").click());
    await vi.waitFor(() => expect(workflow.prepare).toHaveBeenCalledOnce());
    await act(async () => findButton(container, "Batalkan persiapan").click());

    expect(container.textContent).toContain("Persiapan dibatalkan");
    expect(workflow.submit).not.toHaveBeenCalled();
  });

  it("discards a prepared rotation without submitting it", async () => {
    workflow.prepare.mockResolvedValue({
      snapshot: { currentKeyVersion: 1, accounts: [], members: [], pendingInvitationCount: 0 },
      request: { keyVersion: 2 },
    });
    const container = mount();
    root = createRoot(container);

    await act(async () =>
      root?.render(
        createElement(VaultKeyRotationPanel, {
          vaultId: "shared-1",
          vaultName: "Synthetic Team Vault",
          vaultKey: new Uint8Array(32),
          keyVersion: 1,
          onRefresh: async () => undefined,
        }),
      ),
    );
    await act(async () => findButton(container, "Siapkan rotasi kunci Brankas").click());
    await act(async () => findButton(container, "Buang rotasi yang disiapkan").click());

    expect(workflow.submit).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Persiapan dibatalkan");
  });
});

function mount(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.append(container);
  return container;
}

function findButton(container: ParentNode, name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.replace(/\s/g, "") === name.replace(/\s/g, ""),
  );
  if (!button) throw new Error(`Expected button: ${name}`);
  return button;
}
