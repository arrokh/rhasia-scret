import { fireEvent, render } from "@testing-library/react-native";
import type { UnlockedVaultWorkspace } from "@rhasia-scret/client-vault-core";
import type { AuthenticatedTransport } from "@rhasia-scret/client-vault-core";
import { translate } from "../localization";
import { MobileAuthenticatorAccounts } from "./mobile-authenticator-accounts";

const mockSetStringAsync = jest.fn(async (_value: string) => undefined);
jest.mock("expo-clipboard", () => ({ setStringAsync: (value: string) => mockSetStringAsync(value) }));

const transport: AuthenticatedTransport = {
  request: async () => { throw new Error("No network request expected."); },
};

describe("MobileAuthenticatorAccounts", () => {
  beforeEach(() => mockSetStringAsync.mockClear());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("generates a TOTP without network access and copies only after an explicit action", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(59_000));
    const workspace = fixtureWorkspace();
    const screen = await render(
      <MobileAuthenticatorAccounts
        copy={translate("en")}
        refreshWorkspaceAuthorization={async () => undefined}
        transport={transport}
        workspace={workspace}
      />,
    );

    await fireEvent.press(screen.getByRole("button", { name: "Generate offline code" }));
    expect(screen.getByText("94287082")).toBeVisible();
    expect(mockSetStringAsync).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Copy code" }));
    expect(mockSetStringAsync).toHaveBeenCalledWith("94287082");
    expect(screen.getByText("Code copied to the device clipboard.")).toBeVisible();
    jest.useRealTimers();

    workspace.accounts[0].secret.fill(0);
    workspace.userRootKey.fill(0);
    workspace.vaults[0].key.fill(0);
  });

  it("disables every mutation for a read-only offline snapshot while retaining local generation", async () => {
    const workspace = { ...fixtureWorkspace(), syncState: "OFFLINE" as const };
    const screen = await render(
      <MobileAuthenticatorAccounts
        copy={translate("en")}
        refreshWorkspaceAuthorization={async () => undefined}
        transport={transport}
        workspace={workspace}
      />,
    );

    expect(screen.getByText("The offline snapshot is read-only. Code generation and copying remain local; mutations are disabled and will not be queued.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Import Authenticator Account" })).toBeNull();
    expect(screen.getByRole("button", { name: "Generate offline code" })).toBeVisible();
    workspace.accounts[0].secret.fill(0);
    workspace.userRootKey.fill(0);
    workspace.vaults[0].key.fill(0);
  });

  it("owns otpauth validation in the bilingual form model", async () => {
    const workspace = fixtureWorkspace();
    const screen = await render(
      <MobileAuthenticatorAccounts
        copy={translate("id")}
        refreshWorkspaceAuthorization={async () => undefined}
        transport={transport}
        workspace={workspace}
      />,
    );

    await fireEvent.press(screen.getByRole("button", { name: "Impor Akun Authenticator" }));
    expect(await screen.findByText("Masukkan URI otpauth yang valid.")).toBeVisible();
    workspace.accounts[0].secret.fill(0);
    workspace.userRootKey.fill(0);
    workspace.vaults[0].key.fill(0);
  });
});

function fixtureWorkspace(): UnlockedVaultWorkspace {
  return {
    profileId: "profile_1",
    synchronizedAt: "2026-08-11T22:00:00.000Z",
    synchronizationToken: "token",
    syncState: "CURRENT",
    userRootKey: new Uint8Array(32).fill(1),
    vaults: [{
      id: "vault_1",
      name: "Personal",
      type: "PERSONAL",
      role: "OWNER",
      effectiveAccountPermissions: {
        permissions: { canAddAccounts: true, canEditAccounts: true, canDeleteAccounts: true },
        sources: { canAddAccounts: "OWNER", canEditAccounts: "OWNER", canDeleteAccounts: "OWNER" },
      },
      key: new Uint8Array(32).fill(2),
    }],
    accounts: [{
      id: "account_1",
      vaultId: "vault_1",
      vaultName: "Personal",
      vaultType: "PERSONAL",
      revision: 1,
      issuer: "RFC",
      accountName: "vector",
      secret: new TextEncoder().encode("12345678901234567890"),
      algorithm: "SHA-1",
      digits: 8,
      period: 30,
    }],
    unavailableAccounts: [],
    unavailableSharedVaults: 0,
  };
}
