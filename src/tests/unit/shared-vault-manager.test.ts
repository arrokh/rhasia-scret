/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SharedVaultDetails, SharedVaultDirectory } from "@/modules/vault-management/presentation/shared-vault-manager";
import { TestQueryProvider } from "@/tests/test-query-provider";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mocks = vi.hoisted(() => ({ createSharedVaultInvitation: vi.fn() }));
vi.mock("@/modules/vault-membership", async (importOriginal) => ({ ...await importOriginal<typeof import("@/modules/vault-membership")>(), createSharedVaultInvitation: mocks.createSharedVaultInvitation }));

describe("dedicated Vault management", () => {
  let root: Root | undefined;
  afterEach(async () => { await act(async () => root?.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("lists Personal Vault first followed by every Shared Vault", async () => {
    const container = mount(); root = createRoot(container);
    await act(async () => root?.render(createElement(SharedVaultDirectory, { vaults: vaults() })));

    const links = [...container.querySelectorAll<HTMLAnchorElement>("li > a")];
    expect(links.map((link) => link.textContent)).toEqual([
      expect.stringContaining("Brankas Pribadi"),
      expect.stringContaining("Tim Operasional")
    ]);
    expect(links[0]?.pathname).toBe("/vaults/manage/personal");
    expect(links[1]?.pathname).toBe("/vaults/manage/shared-1");
  });

  it("manages accounts on a page, shows the owner, and exposes invitation and audit tabs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ participants: [{ key: "owner:owner-1", email: "owner@example.test", kind: "OWNER", userId: "owner-1", invitationId: null, invitedAt: null }] }) }));
    const onAccountDeleted = vi.fn(async () => undefined);
    const container = mount(); root = createRoot(container);
    await act(async () => root?.render(createElement(TestQueryProvider, null, createElement(SharedVaultDetails, { vault: vaults()[0]!, onRenamed: vi.fn(), onAccountDeleted }))));

    expect(container.querySelector('input[value="Tim Operasional"]')).not.toBeNull();
    await vi.waitFor(() => expect(container.textContent).toContain("owner@example.test"));
    expect(container.querySelector<HTMLAnchorElement>('a[href*="vaultId=shared-1"]')).not.toBeNull();
    expect(findButton(container, "Undangan")).toBeDefined();
    expect(findButton(container, "Audit")).toBeDefined();
    await act(async () => findButton(container, "Hapus Example person@example.test").click());
    expect(onAccountDeleted).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Hapus akun autentikator?");
    await act(async () => findButton(document.body, "Hapus akun").click());
    expect(onAccountDeleted).toHaveBeenCalledWith("shared-1", "account-1", 2);
  });

  it("hides the tab navigation when a Viewer can only see Detail", async () => {
    const viewerVault = { ...vaults()[0]!, role: "VIEWER" as const };
    const container = mount(); root = createRoot(container);
    await act(async () => root?.render(createElement(TestQueryProvider, null, createElement(SharedVaultDetails, { vault: viewerVault, onRenamed: vi.fn(), onAccountDeleted: vi.fn() }))));

    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelector('[role="tab"]')).toBeNull();
    expect(container.textContent).toContain("Akun autentikator");
  });

  it("creates a complete client-only invitation URL from the Undangan tab", async () => {
    mocks.createSharedVaultInvitation.mockResolvedValue({ secret: "client-only-secret" });
    const container = mount(); root = createRoot(container);
    await act(async () => root?.render(createElement(TestQueryProvider, null, createElement(SharedVaultDetails, { vault: vaults()[0]!, onRenamed: vi.fn(), onAccountDeleted: vi.fn() }))));
    await act(async () => {
      const invitationTab = findButton(container, "Undangan");
      invitationTab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      invitationTab.click();
    });
    const email = container.querySelector<HTMLInputElement>("#invitation-email");
    await act(async () => setInputValue(email, "viewer@example.test"));
    await act(async () => email?.form?.requestSubmit());

    await vi.waitFor(() => expect(container.querySelector<HTMLOutputElement>('output[aria-label="Tautan undangan aman"]')?.textContent).toBe("http://localhost:3000/vaults/invitations/redeem#client-only-secret"));
    expect(mocks.createSharedVaultInvitation).toHaveBeenCalledWith("shared-1", "viewer@example.test", vaults()[0]!.key);
  });

  it("opens Audit with an exact account filter and renders the Jakarta event layout", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () => url.includes("/participants") ? { participants: [] } : { events: [{ id: "event-1", eventType: "ACCOUNT_ACCESSED", targetId: "account-1", actorUserId: "viewer-1", actorEmail: "viewer@example.test", createdAt: "2026-07-26T13:28:00.000Z" }] } }));
    vi.stubGlobal("fetch", fetchMock);
    const container = mount(); root = createRoot(container);
    await act(async () => root?.render(createElement(TestQueryProvider, null, createElement(SharedVaultDetails, { vault: vaults()[0]!, onRenamed: vi.fn(), onAccountDeleted: vi.fn() }))));
    await act(async () => findButton(container, "Lihat audit Example person@example.test").click());
    await vi.waitFor(() => expect(container.textContent).toContain("viewer@example.test"));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("audit-events?accountId=account-1"))).toBe(true);
    expect(container.textContent).toContain("Filter: Example · person@example.test");
    expect(container.textContent).toContain("viewer@example.test · 26 Jul 2026, 20.28");
    expect(container.textContent).toContain("Akun autentikator disalin");
    expect(container.textContent).toContain("Example · person@example.test");
  });

  it("lists invited users, filters Audit by exact user id, and deletes a pending Invitation", async () => {
    const participants = [
      { key: "owner:owner-1", email: "owner@example.test", kind: "OWNER", userId: "owner-1", invitationId: null, invitedAt: null },
      { key: "member:viewer-1", email: "viewer@example.test", kind: "MEMBER", userId: "viewer-1", invitationId: null, invitedAt: "2026-07-26T12:00:00.000Z" },
      { key: "invitation:pending-1", email: "pending@example.test", kind: "INVITATION", userId: null, invitationId: "pending-1", invitedAt: "2026-07-26T12:00:00.000Z" }
    ];
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return { ok: true, status: 204 };
      if (url.includes("/participants")) return { ok: true, json: async () => ({ participants }) };
      return { ok: true, json: async () => ({ events: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const container = mount(); root = createRoot(container);
    await act(async () => root?.render(createElement(TestQueryProvider, null, createElement(SharedVaultDetails, { vault: vaults()[0]!, onRenamed: vi.fn(), onAccountDeleted: vi.fn() }))));
    await act(async () => clickTab(container, "Undangan"));
    await vi.waitFor(() => expect(container.textContent).toContain("viewer@example.test"));
    expect(container.textContent).toContain("pending@example.test");

    await act(async () => findButton(container, "Lihat audit viewer@example.test").click());
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("audit-events?actorUserId=viewer-1"))).toBe(true));

    await act(async () => clickTab(container, "Undangan"));
    await act(async () => findButton(container, "Hapus pending@example.test").click());
    await act(async () => findButton(document.body, "Hapus undangan").click());
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/share-links/pending-1") && init?.method === "DELETE")).toBe(true));
  });
});

function vaults() { return [{ id: "shared-1", name: "Tim Operasional", role: "OWNER" as const, key: new Uint8Array(32), accounts: [{ id: "account-1", issuer: "Example", accountName: "person@example.test", revision: 2 }, { id: "account-2", issuer: "Other", accountName: "other@example.test", revision: 1 }] }]; }
function mount() { const container = document.createElement("div"); document.body.append(container); return container; }
function setInputValue(input: HTMLInputElement | null, value: string) { if (!input) throw new Error("Expected input."); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }
function clickTab(container: ParentNode, name: string) { const tab = findButton(container, name); tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })); tab.click(); }
function findButton(container: ParentNode, name: string): HTMLButtonElement { const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.replace(/\s/g, "") === name.replace(/\s/g, "") || candidate.getAttribute("aria-label") === name); if (!button) throw new Error(`Expected button: ${name}`); return button; }
