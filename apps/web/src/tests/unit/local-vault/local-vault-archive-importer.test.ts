/** @vitest-environment jsdom */

import { act, createElement, type ComponentType, type ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../../messages/en.json";
import idMessages from "../../../../messages/id.json";
import type { UnlockedLocalVault } from "@/modules/local-vault";

const archiveMocks = vi.hoisted(() => ({
  importArchive: vi.fn(),
  previewImport: vi.fn(),
}));

vi.mock("@/modules/local-vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/local-vault")>();
  return {
    ...actual,
    importLocalVaultArchive: archiveMocks.importArchive,
    previewLocalVaultArchiveImport: archiveMocks.previewImport,
  };
});

import { LocalArchiveImporter } from "@/modules/local-vault/presentation/local-vault-page";

vi.unmock("next-intl");
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const TestIntlProvider = NextIntlClientProvider as ComponentType<{
  locale: "id" | "en";
  messages: typeof idMessages;
  children?: ReactNode;
}>;

let root: Root | undefined;

const vault: UnlockedLocalVault = {
  profileId: "synthetic-local-profile",
  createdAt: "2026-01-01T00:00:00.000Z",
  name: "Synthetic destination vault",
  rootKey: new Uint8Array(32),
  vaultKey: new Uint8Array(32),
  accounts: [],
};

const noDuplicateReview = {
  sourceVaultName: "Synthetic source vault",
  destinationVaultName: vault.name,
  accounts: [{ issuer: "Example Issuer", accountName: "test@example.invalid", duplicate: false }],
  duplicateCount: 0,
};

const duplicateReview = {
  ...noDuplicateReview,
  accounts: [{ ...noDuplicateReview.accounts[0]!, duplicate: true }],
  duplicateCount: 1,
};

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("Local Vault archive import review", () => {
  it.each([
    { locale: "id", messages: idMessages, reviewButton: "Tinjau arsip", confirmButton: "Konfirmasi dan pulihkan" },
    { locale: "en", messages: enMessages, reviewButton: "Review archive", confirmButton: "Confirm and restore" },
  ] as const)(
    "shows the $locale summary and waits for explicit confirmation",
    async ({ locale, messages, reviewButton, confirmButton }) => {
      archiveMocks.previewImport.mockResolvedValue(noDuplicateReview);
      archiveMocks.importArchive.mockResolvedValue(1);
      const { container, mutationCalls } = await mountImporter(locale, messages);
      chooseFiles(container);

      await act(async () => findButton(container, reviewButton).click());

      expect(container.textContent).toContain("Synthetic source vault");
      expect(container.textContent).toContain("Synthetic destination vault");
      expect(container.textContent).toContain("test@example.invalid");
      expect(archiveMocks.previewImport.mock.calls[0]?.[1]).toEqual(new Uint8Array(3));
      expect(archiveMocks.previewImport.mock.calls[0]?.[2]).toEqual(new Uint8Array(3));
      expect(mutationCalls()).toBe(0);
      expect(archiveMocks.importArchive).not.toHaveBeenCalled();

      await act(async () => findButton(container, confirmButton).click());

      expect(mutationCalls()).toBe(1);
      expect(archiveMocks.importArchive).toHaveBeenCalledOnce();
      expect(archiveMocks.importArchive.mock.calls[0]?.[3]).toBe(false);
    },
  );

  it("makes the user choose whether to skip or add duplicates", async () => {
    archiveMocks.previewImport.mockResolvedValue(duplicateReview);
    archiveMocks.importArchive.mockResolvedValue(1);
    const { container, mutationCalls } = await mountImporter("id", idMessages);
    chooseFiles(container);

    await act(async () => findButton(container, "Tinjau arsip").click());

    expect(container.textContent).toContain("1 akun duplikat");
    expect(container.textContent).toContain("Akun duplikat");
    expect(mutationCalls()).toBe(0);
    expect(findButton(container, "Pulihkan akun baru saja")).toBeDefined();
    expect(findButton(container, "Tetap tambahkan duplikat")).toBeDefined();

    await act(async () => findButton(container, "Tetap tambahkan duplikat").click());

    expect(archiveMocks.importArchive.mock.calls[0]?.[3]).toBe(true);
  });

  it("skips duplicates only after the user chooses to restore new accounts", async () => {
    archiveMocks.previewImport.mockResolvedValue(duplicateReview);
    archiveMocks.importArchive.mockResolvedValue(1);
    const { container } = await mountImporter("id", idMessages);
    chooseFiles(container);

    await act(async () => findButton(container, "Tinjau arsip").click());
    await act(async () => findButton(container, "Pulihkan akun baru saja").click());

    expect(archiveMocks.importArchive.mock.calls[0]?.[3]).toBe(false);
  });

  it("cancels the review without mutating the Local Vault", async () => {
    archiveMocks.previewImport.mockResolvedValue(duplicateReview);
    const { container, mutationCalls } = await mountImporter("id", idMessages);
    chooseFiles(container);

    await act(async () => findButton(container, "Tinjau arsip").click());
    await act(async () => findButton(container, "Batalkan tinjauan").click());

    expect(mutationCalls()).toBe(0);
    expect(archiveMocks.importArchive).not.toHaveBeenCalled();
  });
});

async function mountImporter(
  locale: "id" | "en",
  messages: typeof idMessages,
): Promise<{
  container: HTMLDivElement;
  mutationCalls: () => number;
}> {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  let mutationCount = 0;
  const runMutation: <Result>(operation: (current: UnlockedLocalVault) => Promise<Result>) => Promise<Result> = async (
    operation,
  ) => {
    mutationCount += 1;
    return operation(vault);
  };
  await act(async () => {
    root?.render(
      createElement(
        TestIntlProvider,
        { locale, messages },
        createElement(LocalArchiveImporter, {
          vault,
          runMutation,
          refresh: vi.fn().mockResolvedValue(undefined),
          onError: vi.fn(),
          onStatus: vi.fn(),
          importing: false,
          setImporting: vi.fn(),
        }),
      ),
    );
  });
  return { container, mutationCalls: () => mutationCount };
}

function chooseFiles(container: ParentNode): void {
  const [archiveInput, keyInput] = [...container.querySelectorAll<HTMLInputElement>('input[type="file"]')];
  if (!archiveInput || !keyInput) throw new Error("Expected archive and key file inputs.");

  const archive = new File(["synthetic encrypted archive"], "sample.rhasia");
  Object.defineProperty(archive, "arrayBuffer", { value: async () => new Uint8Array([1, 2, 3]).buffer });
  const key = new File(["synthetic archive key"], "sample-key.txt");
  Object.defineProperty(key, "text", { value: async () => "AQID" });
  Object.defineProperty(archiveInput, "files", { configurable: true, value: [archive] });
  Object.defineProperty(keyInput, "files", { configurable: true, value: [key] });
  archiveInput.dispatchEvent(new Event("change", { bubbles: true }));
  keyInput.dispatchEvent(new Event("change", { bubbles: true }));
}

function findButton(container: ParentNode, name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
    candidate.textContent?.includes(name),
  );
  if (!button) throw new Error(`Expected button: ${name}`);
  return button;
}
