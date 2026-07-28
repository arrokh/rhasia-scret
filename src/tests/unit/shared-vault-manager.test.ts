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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ owner: { id: "owner-1", email: "owner@example.test" }, participants: [], nextCursor: null }) }));
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
    const viewerVault = { ...vaults()[0]!, role: "VIEWER" as const, effectiveAccountPermissions: { permissions: { canAddAccounts: false, canEditAccounts: false, canDeleteAccounts: false }, sources: { canAddAccounts: "VAULT" as const, canEditAccounts: "VAULT" as const, canDeleteAccounts: "VAULT" as const } } };
    const container = mount(); root = createRoot(container);
    await act(async () => root?.render(createElement(TestQueryProvider, null, createElement(SharedVaultDetails, { vault: viewerVault, onRenamed: vi.fn(), onAccountDeleted: vi.fn() }))));

    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelector('[role="tab"]')).toBeNull();
    expect(container.textContent).toContain("Akun autentikator");
  });

  it("shows only the independently authorized account controls for a Viewer", async () => {
    const viewerVault = { ...vaults()[0]!, role: "VIEWER" as const, effectiveAccountPermissions: { permissions: { canAddAccounts: true, canEditAccounts: false, canDeleteAccounts: false }, sources: { canAddAccounts: "VAULT" as const, canEditAccounts: "VAULT" as const, canDeleteAccounts: "MEMBER" as const } } };
    const container = mount(); root = createRoot(container);
    await act(async () => root?.render(createElement(TestQueryProvider, null, createElement(SharedVaultDetails, { vault: viewerVault, onRenamed: vi.fn(), onAccountDeleted: vi.fn() }))));

    expect(container.querySelector<HTMLAnchorElement>('a[href*="vaultId=shared-1"]')).not.toBeNull();
    expect([...container.querySelectorAll("button")].some((button) => button.getAttribute("aria-label")?.startsWith("Hapus Example"))).toBe(false);
    expect(container.textContent).toContain("Dapat menambah");
  });

  it("edits Vault defaults and exposes independent member fallback controls", async () => {
    const participant = {
      key: "member:viewer-1",
      email: "viewer@example.test",
      kind: "MEMBER",
      userId: "viewer-1",
      invitationId: null,
      invitedAt: "2026-07-26T12:00:00.000Z",
      permissionOverrides: { canAddAccounts: null, canEditAccounts: true, canDeleteAccounts: false },
      effectiveAccountPermissions: {
        permissions: { canAddAccounts: false, canEditAccounts: true, canDeleteAccounts: false },
        sources: { canAddAccounts: "VAULT", canEditAccounts: "MEMBER", canDeleteAccounts: "MEMBER" }
      },
      permissionsRevision: 2
    };
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return { ok: true, json: async () => ({ vaultDefaultAccountPermissions: { canAddAccounts: true, canEditAccounts: false, canDeleteAccounts: false }, vaultDefaultAccountPermissionsRevision: 2 }) };
      if (url.includes("/participants")) return { ok: true, json: async () => ({ owner: { id: "owner-1", email: "owner@example.test" }, vaultDefaultAccountPermissions: { canAddAccounts: false, canEditAccounts: false, canDeleteAccounts: false }, vaultDefaultAccountPermissionsRevision: 1, participants: [participant], nextCursor: null }) };
      return { ok: true, json: async () => ({ events: [], nextCursor: null }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const container = mount(); root = createRoot(container);
    await act(async () => root?.render(createElement(TestQueryProvider, null, createElement(SharedVaultDetails, { vault: vaults()[0]!, onRenamed: vi.fn(), onAccountDeleted: vi.fn() }))));

    await vi.waitFor(() => expect(container.textContent).toContain("Izin akun bawaan anggota"));
    await act(async () => container.querySelector<HTMLButtonElement>("#vault-default-canAddAccounts")?.click());
    await act(async () => findButton(container, "Simpan bawaan anggota").click());
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/member-permissions") && init?.method === "PATCH" && String(init.body).includes('"canAddAccounts":true'))).toBe(true));

    await act(async () => clickTab(container, "Undangan"));
    await vi.waitFor(() => expect(container.textContent).toContain("viewer@example.test"));
    await act(async () => findButton(container, "Atur izin akun untuk viewer@example.test").click());
    expect(document.body.textContent).toContain("Izin akun anggota");
    expect(document.body.querySelectorAll('[role="combobox"]')).toHaveLength(3);
    expect(document.body.textContent).toContain("Gunakan bawaan Brankas");
    expect(document.body.textContent).toContain("penggantian anggota");
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
    const fetchMock = vi.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () => url.includes("/participants") ? { owner: { id: "owner-1", email: "owner@example.test" }, participants: [], nextCursor: null } : { events: [{ id: "event-1", eventType: "ACCOUNT_ACCESSED", targetId: "account-1", actorUserId: "viewer-1", actorEmail: "viewer@example.test", createdAt: "2026-07-26T13:28:00.000Z" }], nextCursor: null } }));
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

  it("renders loading and empty states for both paginated lists", async () => {
    let resolveParticipants: ((response: unknown) => void) | undefined;
    let resolveAudit: ((response: unknown) => void) | undefined;
    const fetchMock = vi.fn().mockImplementation((url: string) => new Promise((resolve) => {
      if (String(url).includes("/participants")) resolveParticipants = resolve;
      else resolveAudit = resolve;
    }));
    vi.stubGlobal("fetch", fetchMock);
    const container = mount(); root = createRoot(container);
    await act(async () => root?.render(createElement(TestQueryProvider, null, createElement(SharedVaultDetails, { vault: vaults()[0]!, onRenamed: vi.fn(), onAccountDeleted: vi.fn() }))));

    await act(async () => clickTab(container, "Undangan"));
    expect(container.textContent).toContain("Memuat pengguna…");
    await act(async () => resolveParticipants?.({ ok: true, json: async () => ({ owner: { id: "owner-1", email: "owner@example.test" }, participants: [], nextCursor: null }) }));
    await vi.waitFor(() => expect(container.textContent).toContain("Belum ada pengguna yang diundang."));

    await act(async () => clickTab(container, "Audit"));
    expect(container.textContent).toContain("Memuat riwayat audit…");
    await act(async () => resolveAudit?.({ ok: true, json: async () => ({ events: [], nextCursor: null }) }));
    await vi.waitFor(() => expect(container.textContent).toContain("Belum ada aktivitas"));
  });

  it("renders request errors for both paginated lists", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "unavailable" }) }));
    const container = mount(); root = createRoot(container);
    await act(async () => root?.render(createElement(TestQueryProvider, null, createElement(SharedVaultDetails, { vault: vaults()[0]!, onRenamed: vi.fn(), onAccountDeleted: vi.fn() }))));
    await act(async () => clickTab(container, "Undangan"));
    await vi.waitFor(() => expect(container.textContent).toContain("Daftar pengguna tidak dapat dimuat."));
    await act(async () => clickTab(container, "Audit"));
    await vi.waitFor(() => expect(container.textContent).toContain("Riwayat audit tidak dapat dimuat."));
  });

  it("retains loaded rows and reports subsequent page failures", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const requestUrl = String(url);
      if (requestUrl.includes("cursor=")) return { ok: false, status: 500, json: async () => ({ error: "unavailable" }) };
      if (requestUrl.includes("/participants")) return { ok: true, json: async () => ({ owner: { id: "owner-1", email: "owner@example.test" }, participants: [{ key: "member:viewer-1", email: "viewer1@example.test", kind: "MEMBER", userId: "viewer-1", invitationId: null, invitedAt: "2026-07-26T12:00:00.000Z" }], nextCursor: "participants-page-2" }) };
      return { ok: true, json: async () => ({ events: [{ id: "event-1", eventType: "ACCOUNT_ACCESSED", targetId: "account-1", actorUserId: "viewer-1", actorEmail: "viewer1@example.test", createdAt: "2026-07-26T13:28:00.000Z" }], nextCursor: "audit-page-2" }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const container = mount(); root = createRoot(container);
    await act(async () => root?.render(createElement(TestQueryProvider, null, createElement(SharedVaultDetails, { vault: vaults()[0]!, onRenamed: vi.fn(), onAccountDeleted: vi.fn() }))));

    await act(async () => clickTab(container, "Undangan"));
    await vi.waitFor(() => expect(container.textContent).toContain("viewer1@example.test"));
    await act(async () => findButton(container, "Muat lebih banyak pengguna").click());
    await vi.waitFor(() => expect(container.textContent).toContain("Pengguna berikutnya tidak dapat dimuat."));
    expect(container.textContent).toContain("viewer1@example.test");

    await act(async () => clickTab(container, "Audit"));
    await vi.waitFor(() => expect(container.textContent).toContain("Akun autentikator disalin"));
    await act(async () => findButton(container, "Muat lebih banyak aktivitas").click());
    await vi.waitFor(() => expect(container.textContent).toContain("Aktivitas berikutnya tidak dapat dimuat."));
    expect(container.textContent).toContain("viewer1@example.test");
  });

  it("loads subsequent cursor pages and exposes completion states in Undangan and Audit", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/participants")) {
        const secondPage = requestUrl.includes("cursor=participants-page-2");
        return { ok: true, json: async () => ({
          owner: { id: "owner-1", email: "owner@example.test" },
          participants: [{ key: `member:viewer-${secondPage ? "2" : "1"}`, email: `viewer${secondPage ? "2" : "1"}@example.test`, kind: "MEMBER", userId: `viewer-${secondPage ? "2" : "1"}`, invitationId: null, invitedAt: "2026-07-26T12:00:00.000Z" }],
          nextCursor: secondPage ? null : "participants-page-2"
        }) };
      }
      const secondPage = requestUrl.includes("cursor=audit-page-2");
      return { ok: true, json: async () => ({ events: [{ id: `event-${secondPage ? "2" : "1"}`, eventType: "ACCOUNT_ACCESSED", targetId: "account-1", actorUserId: `viewer-${secondPage ? "2" : "1"}`, actorEmail: `viewer${secondPage ? "2" : "1"}@example.test`, createdAt: "2026-07-26T13:28:00.000Z" }], nextCursor: secondPage ? null : "audit-page-2" }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const container = mount(); root = createRoot(container);
    await act(async () => root?.render(createElement(TestQueryProvider, null, createElement(SharedVaultDetails, { vault: vaults()[0]!, onRenamed: vi.fn(), onAccountDeleted: vi.fn() }))));

    await act(async () => clickTab(container, "Undangan"));
    await vi.waitFor(() => expect(container.textContent).toContain("viewer1@example.test"));
    await act(async () => findButton(container, "Muat lebih banyak pengguna").click());
    await vi.waitFor(() => expect(container.textContent).toContain("viewer2@example.test"));
    expect(container.textContent).toContain("Semua pengguna telah dimuat.");

    await act(async () => clickTab(container, "Audit"));
    await vi.waitFor(() => expect(container.textContent).toContain("viewer1@example.test"));
    await act(async () => findButton(container, "Muat lebih banyak aktivitas").click());
    await vi.waitFor(() => expect(container.textContent).toContain("viewer2@example.test"));
    expect(container.textContent).toContain("Semua aktivitas telah dimuat.");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("participants?cursor=participants-page-2"))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("audit-events?cursor=audit-page-2"))).toBe(true);
  });

  it("lists invited users, filters Audit by exact user id, and deletes a pending Invitation", async () => {
    const participants = [
      { key: "member:viewer-1", email: "viewer@example.test", kind: "MEMBER", userId: "viewer-1", invitationId: null, invitedAt: "2026-07-26T12:00:00.000Z" },
      { key: "invitation:pending-1", email: "pending@example.test", kind: "INVITATION", userId: null, invitationId: "pending-1", invitedAt: "2026-07-26T12:00:00.000Z" }
    ];
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return { ok: true, status: 204 };
      if (url.includes("/participants")) return { ok: true, json: async () => ({ owner: { id: "owner-1", email: "owner@example.test" }, participants, nextCursor: null }) };
      return { ok: true, json: async () => ({ events: [], nextCursor: null }) };
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

function vaults() { return [{ id: "shared-1", name: "Tim Operasional", role: "OWNER" as const, effectiveAccountPermissions: { permissions: { canAddAccounts: true, canEditAccounts: true, canDeleteAccounts: true }, sources: { canAddAccounts: "OWNER" as const, canEditAccounts: "OWNER" as const, canDeleteAccounts: "OWNER" as const } }, key: new Uint8Array(32), accounts: [{ id: "account-1", issuer: "Example", accountName: "person@example.test", revision: 2 }, { id: "account-2", issuer: "Other", accountName: "other@example.test", revision: 1 }] }]; }
function mount() { const container = document.createElement("div"); document.body.append(container); return container; }
function setInputValue(input: HTMLInputElement | null, value: string) { if (!input) throw new Error("Expected input."); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }
function clickTab(container: ParentNode, name: string) { const tab = findButton(container, name); tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })); tab.click(); }
function findButton(container: ParentNode, name: string): HTMLButtonElement { const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.replace(/\s/g, "") === name.replace(/\s/g, "") || candidate.getAttribute("aria-label") === name); if (!button) throw new Error(`Expected button: ${name}`); return button; }
