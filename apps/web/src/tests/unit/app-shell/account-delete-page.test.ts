import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadServerAccountDeletionContext: vi.fn(),
  redirect: vi.fn((path: string): never => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/shared/infrastructure/server-api-gateway", () => ({
  loadServerAccountDeletionContext: mocks.loadServerAccountDeletionContext,
  isServerApiConfigurationError: (error: unknown) =>
    Boolean(error && typeof error === "object" && "name" in error && error.name === "ServerApiConfigurationError"),
  isServerApiUnavailableError: (error: unknown) =>
    Boolean(error && typeof error === "object" && "name" in error && error.name === "ServerApiUnavailableError"),
}));
vi.mock("@/modules/authenticator-account", () => ({
  UnlockedVaultWorkspaceProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/modules/account-deletion", () => ({
  AccountDeletionPage: ({ email }: { email: string }) => createElement("div", null, email),
}));

import AccountDeletePage from "@/app/account/delete/page";

beforeEach(() => {
  mocks.loadServerAccountDeletionContext.mockReset();
  mocks.redirect.mockClear();
});

describe("AccountDeletePage", () => {
  it("routes API outages to sign in with a temporary-unavailability notice", async () => {
    mocks.loadServerAccountDeletionContext.mockRejectedValue({ name: "ServerApiUnavailableError" });

    await expect(AccountDeletePage()).rejects.toThrow("redirect:/sign-in?auth=service_unavailable");
  });

  it("routes API configuration failures to the configuration notice", async () => {
    mocks.loadServerAccountDeletionContext.mockRejectedValue({ name: "ServerApiConfigurationError" });

    await expect(AccountDeletePage()).rejects.toThrow("redirect:/sign-in?auth=configuration_error");
  });

  it("does not disguise unexpected failures", async () => {
    mocks.loadServerAccountDeletionContext.mockRejectedValue(new Error("unexpected programming error"));

    await expect(AccountDeletePage()).rejects.toThrow("unexpected programming error");
  });
});
