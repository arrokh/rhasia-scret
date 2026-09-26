/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserEncryptionIdentityRotation } from "@/modules/identity/presentation/user-encryption-identity-rotation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const workflow = vi.hoisted(() => ({
  prepare: vi.fn(),
  submit: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock("@/modules/identity/infrastructure/browser-user-encryption-identity-rotation-workflow", () => ({
  prepareBrowserUserEncryptionIdentityRotation: workflow.prepare,
  submitPreparedBrowserUserEncryptionIdentityRotation: workflow.submit,
  reconcilePreparedBrowserUserEncryptionIdentityRotation: workflow.reconcile,
}));

describe("UserEncryptionIdentityRotation", () => {
  let root: Root | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("reconciles an ambiguous response and never repeats the submitted rotation", async () => {
    workflow.prepare.mockResolvedValue({
      snapshot: { memberships: [{ vaultId: "shared-1" }] },
      request: { publicKey: { kty: "EC", crv: "P-256" } },
    });
    workflow.submit.mockResolvedValue("UNKNOWN");
    workflow.reconcile.mockResolvedValueOnce("UNKNOWN").mockResolvedValueOnce("COMMITTED");
    const onRefresh = vi.fn(async () => undefined);
    const container = mount();
    root = createRoot(container);

    await act(async () =>
      root?.render(
        createElement(UserEncryptionIdentityRotation, {
          userRootKey: new Uint8Array(32),
          profileId: "profile-1",
          publicKey: { kty: "EC", crv: "P-256" },
          onRefresh,
        }),
      ),
    );
    await act(async () => findButton(container, "Siapkan rotasi pasangan kunci").click());
    await act(async () => findButton(container, "Tinjau rotasi").click());
    await act(async () => findButton(document.body, "Rotasikan pasangan kunci").click());

    expect(workflow.submit).toHaveBeenCalledOnce();
    expect(workflow.reconcile).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Hasil rotasi belum dapat diverifikasi");
    expect(findButton(container, "Periksa status rotasi")).toBeDefined();

    await act(async () => findButton(container, "Periksa status rotasi").click());
    expect(workflow.submit).toHaveBeenCalledOnce();
    expect(workflow.reconcile).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Pasangan Kunci Enkripsi Pengguna berhasil dirotasi");
  });

  it("cancels in-flight preparation without submitting key material", async () => {
    workflow.prepare.mockImplementation(
      (_userRootKey: Uint8Array, _profileId: string, _publicKey: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        }),
    );
    const container = mount();
    root = createRoot(container);

    await act(async () =>
      root?.render(
        createElement(UserEncryptionIdentityRotation, {
          userRootKey: new Uint8Array(32),
          profileId: "profile-1",
          publicKey: { kty: "EC", crv: "P-256" },
          onRefresh: async () => undefined,
        }),
      ),
    );
    await act(async () => findButton(container, "Siapkan rotasi pasangan kunci").click());
    await vi.waitFor(() => expect(workflow.prepare).toHaveBeenCalledOnce());
    await act(async () => findButton(container, "Batalkan persiapan").click());

    expect(container.textContent).toContain("Persiapan dibatalkan");
    expect(workflow.submit).not.toHaveBeenCalled();
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
