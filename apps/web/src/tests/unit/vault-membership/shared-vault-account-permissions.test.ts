import { describe, expect, it } from "vitest";
import {
  ALL_ACCOUNT_PERMISSIONS,
  canPerformSharedVaultAccountOperation,
  effectiveSharedVaultAccountPermissions,
  type SharedVaultAccountPermissionOverrides,
  type SharedVaultAccountPermissions,
} from "@/modules/vault-membership";

const values = [false, true] as const;
const overrides = [null, false, true] as const;

describe("Shared Vault account permissions", () => {
  it("gives an owner every capability regardless of defaults and member overrides", () => {
    expect(
      effectiveSharedVaultAccountPermissions(
        "OWNER",
        {
          canAddAccounts: false,
          canEditAccounts: false,
          canDeleteAccounts: false,
        },
        {
          canAddAccounts: false,
          canEditAccounts: false,
          canDeleteAccounts: false,
        },
      ),
    ).toEqual({
      permissions: ALL_ACCOUNT_PERMISSIONS,
      sources: { canAddAccounts: "OWNER", canEditAccounts: "OWNER", canDeleteAccounts: "OWNER" },
    });
  });

  it("resolves every member capability independently across all default and override combinations", () => {
    for (const canAddAccounts of values)
      for (const canEditAccounts of values)
        for (const canDeleteAccounts of values) {
          const defaults: SharedVaultAccountPermissions = { canAddAccounts, canEditAccounts, canDeleteAccounts };
          for (const addOverride of overrides)
            for (const editOverride of overrides)
              for (const deleteOverride of overrides) {
                const memberOverrides: SharedVaultAccountPermissionOverrides = {
                  canAddAccounts: addOverride,
                  canEditAccounts: editOverride,
                  canDeleteAccounts: deleteOverride,
                };
                expect(effectiveSharedVaultAccountPermissions("VIEWER", defaults, memberOverrides)).toEqual({
                  permissions: {
                    canAddAccounts: addOverride ?? canAddAccounts,
                    canEditAccounts: editOverride ?? canEditAccounts,
                    canDeleteAccounts: deleteOverride ?? canDeleteAccounts,
                  },
                  sources: {
                    canAddAccounts: addOverride === null ? "VAULT" : "MEMBER",
                    canEditAccounts: editOverride === null ? "VAULT" : "MEMBER",
                    canDeleteAccounts: deleteOverride === null ? "VAULT" : "MEMBER",
                  },
                });
              }
        }
  });

  it("maps operations to only their matching capability", () => {
    const permissions = { canAddAccounts: true, canEditAccounts: false, canDeleteAccounts: true };
    expect(canPerformSharedVaultAccountOperation(permissions, "ADD")).toBe(true);
    expect(canPerformSharedVaultAccountOperation(permissions, "EDIT")).toBe(false);
    expect(canPerformSharedVaultAccountOperation(permissions, "DELETE")).toBe(true);
  });
});
