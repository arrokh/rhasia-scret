/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserApiError } from "@/shared/infrastructure/browser-api-client";
import { TestQueryProvider } from "@/tests/test-query-provider";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mocks = vi.hoisted(() => ({ enrollPasskeyRecovery: vi.fn() }));
vi.mock("@/modules/crypto/infrastructure/browser-passkey-recovery-workflow", () => ({ enrollPasskeyRecovery: mocks.enrollPasskeyRecovery }));

import { PasskeyRecoveryEnrollment } from "@/modules/crypto/presentation/passkey-recovery-enrollment";

describe("PasskeyRecoveryEnrollment", () => {
  let root: Root | undefined;
  afterEach(async () => {
    await act(async () => root?.unmount());
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows the persisted active state instead of offering duplicate enrollment", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enrolled: true }) }));
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(TestQueryProvider, null, createElement(PasskeyRecoveryEnrollment, { userRootKey: new Uint8Array(32) }))));
    await vi.waitFor(() => expect(container.textContent).toContain("Pemulihan kunci akses aktif"));

    expect(container.textContent).toContain("tidak perlu mengaktifkannya lagi");
    expect(findButton(container, "Aktifkan pemulihan kunci akses")).toBeUndefined();
    expect(container.querySelector<HTMLAnchorElement>('a[href="/vaults/recovery"]')).not.toBeNull();
  });

  it("confirms and detaches persisted Passkey-Assisted Recovery", async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === "/api/passkey-recovery/status") return { ok: true, json: async () => ({ enrolled: true }) };
      if (input === "/api/passkey-recovery" && init?.method === "DELETE") return { ok: true, status: 204 };
      throw new Error(`Unexpected request: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(TestQueryProvider, null, createElement(PasskeyRecoveryEnrollment, { userRootKey: new Uint8Array(32) }))));
    await vi.waitFor(() => expect(findButton(container, "Hapus pemulihan kunci akses")).not.toBeUndefined());

    await act(async () => findButton(container, "Hapus pemulihan kunci akses")?.click());
    expect(document.body.textContent).toContain("Passphrase Brankas tetap berlaku");
    await act(async () => findButton(document.body, "Hapus pemulihan")?.click());
    await vi.waitFor(() => expect(findButton(container, "Aktifkan pemulihan kunci akses")).not.toBeUndefined());

    expect(fetchMock).toHaveBeenCalledWith("/api/passkey-recovery", { method: "DELETE" });
    expect(container.textContent).toContain("Pemulihan kunci akses telah dihapus");
    expect(container.textContent).not.toContain("Pemulihan kunci akses aktif");
  });

  it("shows the specific server failure instead of blaming every failure on browser support", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enrolled: false }) }));
    mocks.enrollPasskeyRecovery.mockRejectedValue(new BrowserApiError("Request failed.", 400, "passkey_verification_failed"));
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(TestQueryProvider, null, createElement(PasskeyRecoveryEnrollment, { userRootKey: new Uint8Array(32) }))));
    await vi.waitFor(() => expect(findButton(container, "Aktifkan pemulihan kunci akses")).not.toBeUndefined());
    await act(async () => findButton(container, "Aktifkan pemulihan kunci akses")?.click());

    expect(container.textContent).toContain("Passkey tidak dapat diverifikasi");
    expect(container.textContent).not.toContain("Browser ini harus mendukung PRF WebAuthn");
  });
});

function findButton(container: HTMLElement, label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes(label));
}
