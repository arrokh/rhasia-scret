import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadServerVaultPageContext: vi.fn(),
  redirect: vi.fn((path: string): never => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/shared/infrastructure/server-api-gateway", () => ({
  loadServerVaultPageContext: mocks.loadServerVaultPageContext,
  isServerApiConfigurationError: (error: unknown) =>
    Boolean(error && typeof error === "object" && "name" in error && error.name === "ServerApiConfigurationError"),
  isServerApiUnavailableError: (error: unknown) =>
    Boolean(error && typeof error === "object" && "name" in error && error.name === "ServerApiUnavailableError"),
}));

import { loadVaultPageContext } from "@/modules/vault-management/presentation/load-vault-page-context";

beforeEach(() => {
  mocks.loadServerVaultPageContext.mockReset();
  mocks.redirect.mockClear();
});

describe("loadVaultPageContext", () => {
  it("routes unauthenticated users to sign in", async () => {
    mocks.loadServerVaultPageContext.mockResolvedValue(null);

    await expect(loadVaultPageContext()).rejects.toThrow("redirect:/sign-in");
  });

  it("routes API outages to sign in with a temporary-unavailability notice", async () => {
    mocks.loadServerVaultPageContext.mockRejectedValue({ name: "ServerApiUnavailableError" });

    await expect(loadVaultPageContext()).rejects.toThrow("redirect:/sign-in?auth=service_unavailable");
  });

  it("routes known API configuration failures to the configuration notice", async () => {
    mocks.loadServerVaultPageContext.mockRejectedValue({ name: "ServerApiConfigurationError" });

    await expect(loadVaultPageContext()).rejects.toThrow("redirect:/sign-in?auth=configuration_error");
  });

  it("does not hide unexpected errors", async () => {
    mocks.loadServerVaultPageContext.mockRejectedValue(new Error("unexpected programming error"));

    await expect(loadVaultPageContext()).rejects.toThrow("unexpected programming error");
  });
});
