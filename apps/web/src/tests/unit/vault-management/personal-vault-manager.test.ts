/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PersonalVaultDetails } from "@/modules/vault-management/presentation/personal-vault-manager";
import { TestQueryProvider } from "@/tests/test-query-provider";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("Personal Vault management", () => {
  let root: Root | undefined;
  afterEach(async () => {
    await act(async () => root?.unmount());
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("uses the Shared Vault management structure without Shared-only controls", async () => {
    const onAccountDeleted = vi.fn(async () => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        events: [
          {
            id: "archive-event",
            eventType: "ARCHIVE_IMPORTED",
            targetId: null,
            actorUserId: "owner-1",
            actorEmail: "owner@example.test",
            createdAt: "2026-07-27T12:00:00.000Z",
          },
        ],
        nextCursor: null,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () =>
      root?.render(
        createElement(
          TestQueryProvider,
          null,
          createElement(PersonalVaultDetails, {
            vault: {
              id: "personal-1",
              name: "Brankas Pribadi",
              accounts: [{ id: "account-1", issuer: "Example", accountName: "person@example.test", revision: 3 }],
            },
            ownerEmail: "owner@example.test",
            onAccountDeleted,
          }),
        ),
      ),
    );

    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    expect([...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(["Detail", "Audit"]);
    expect(container.textContent).toContain("owner@example.test");
    expect(container.textContent).toContain("Brankas Pribadi");
    expect(
      container.querySelector<HTMLAnchorElement>('a[href="/vaults/accounts/new?vaultId=personal-1"]'),
    ).not.toBeNull();
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Undangan")).toBe(false);
    await act(async () => clickTab(container, "Audit"));
    await vi.waitFor(() => expect(container.textContent).toContain("Arsip Brankas diimpor"));
    expect(fetchMock).toHaveBeenCalledWith("/api/vaults/personal-1/audit-events", { cache: "no-store", method: "GET" });
    await act(async () => clickTab(container, "Detail"));

    await act(async () => findButton(container, "Hapus Example person@example.test").click());
    expect(document.body.textContent).toContain("Hapus akun autentikator?");
    await act(async () => findButton(document.body, "Hapus akun").click());
    expect(onAccountDeleted).toHaveBeenCalledWith("personal-1", "account-1", 3);
  });
});

function clickTab(container: ParentNode, name: string) {
  const tab = findButton(container, name);
  tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  tab.click();
}

function findButton(container: ParentNode, name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) =>
      candidate.textContent?.replace(/\s/g, "") === name.replace(/\s/g, "") ||
      candidate.getAttribute("aria-label") === name,
  );
  if (!button) throw new Error(`Expected button: ${name}`);
  return button;
}
