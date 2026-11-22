import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ loadVaultPageContext: vi.fn() }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string) => `${namespace}.${key}`,
}));
vi.mock("@/modules/vault-management/page", () => ({
  loadVaultPageContext: mocks.loadVaultPageContext,
  PersonalVaultSetupFormBoundary: () => createElement("span", null, "setup-form"),
  VaultPageLogoutAction: () => createElement("span", null, "logout-action"),
}));
vi.mock("@/modules/authenticator-account", () => ({
  PersonalVaultAccounts: () => createElement("span", null, "accounts"),
}));
vi.mock("@/shared/presentation/app-ui", () => ({
  AppPage: ({ children }: { children: ReactNode }) => createElement("main", null, children),
  PageHeader: ({ title }: { title: string }) => createElement("header", null, title),
  SectionHeading: ({ title }: { title: string }) => createElement("h2", null, title),
  StatusBanner: ({ children, role }: { children: ReactNode; role?: string }) => createElement("p", { role }, children),
  SurfaceCard: ({ children }: { children: ReactNode }) => createElement("section", null, children),
}));
vi.mock("@/shared/presentation/contextual-help", () => ({
  ContextualHelpButton: () => createElement("span", null, "help"),
}));
vi.mock("@/shared/presentation/loading-placeholder", () => ({
  ActionLoadingPlaceholder: () => createElement("span", null, "loading"),
}));

import VaultsPage from "@/app/vaults/page";

beforeEach(() => {
  mocks.loadVaultPageContext.mockResolvedValue({
    personalVault: { lifecycle: "UNINITIALIZED", id: "synthetic-vault" },
  });
});

describe("VaultsPage session cleanup notices", () => {
  it("shows localized warnings after destructive reset cleanup failure or uncertain logout", async () => {
    const page = await VaultsPage({
      searchParams: Promise.resolve({ reset: ["other", "cleanup-warning"], logout: ["failed"] }),
    });
    const markup = renderToStaticMarkup(createElement("div", null, page));

    expect(markup).toContain("VaultManagement.destructiveReset.cleanupError");
    expect(markup).toContain("Identity.logout.cleanupError");
  });
});
