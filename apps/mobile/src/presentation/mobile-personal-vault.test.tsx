import { act, fireEvent, render } from "@testing-library/react-native";
import { AppState } from "react-native";
import type { UnlockedVaultWorkspace } from "../../../../src/modules/authenticator-account/application/vault-workspace";
import type { AuthenticatedTransport, PlatformHttpResponse } from "../../../../src/shared/application/platform-ports";
import { translate } from "../localization";
import { MobilePersonalVaultRepository } from "../infrastructure/mobile-personal-vault-repository";
import * as workspaceModule from "../infrastructure/mobile-vault-workspace";
import { MobilePersonalVault } from "./mobile-personal-vault";

const uninitializedResponse: PlatformHttpResponse = {
  status: 200,
  ok: true,
  headers: new Headers({ "content-type": "application/json" }),
  json: async <Value,>() => ({ id: "personal-vault-1", lifecycle: "UNINITIALIZED" }) as Value,
  bytes: async () => new Uint8Array(),
  text: async () => JSON.stringify({ id: "personal-vault-1", lifecycle: "UNINITIALIZED" }),
};

const transport: AuthenticatedTransport = { request: async () => uninitializedResponse };
const activeTransport: AuthenticatedTransport = { request: async () => ({
  ...uninitializedResponse,
  json: async <Value,>() => ({ id: "personal-vault-1", lifecycle: "ACTIVE" }) as Value,
  text: async () => JSON.stringify({ id: "personal-vault-1", lifecycle: "ACTIVE" }),
}) };

describe("MobilePersonalVault", () => {
  afterEach(() => jest.restoreAllMocks());

  it("renders complete Indonesian setup copy and form-owned validation", async () => {
    const screen = await render(
      <MobilePersonalVault copy={translate("id")} repository={new MobilePersonalVaultRepository(transport)} transport={transport} />,
    );

    expect(await screen.findByRole("header", { name: "Amankan Brankas Pribadi" })).toBeVisible();
    expect(screen.getByLabelText("Nama Brankas")).toHaveDisplayValue("Brankas Pribadi");
    await fireEvent.press(screen.getByRole("button", { name: "Amankan Brankas Pribadi" }));
    expect(await screen.findByText("Passphrase Brankas harus berisi setidaknya tiga karakter.")).toBeVisible();
    expect(screen.getByText("Konfirmasikan bahwa Passphrase Brankas telah disimpan.")).toBeVisible();
  });

  it("renders the active Vault unlock ceremony in English", async () => {
    const screen = await render(
      <MobilePersonalVault copy={translate("en")} repository={new MobilePersonalVaultRepository(activeTransport)} transport={activeTransport} />,
    );

    expect(await screen.findByRole("header", { name: "Personal Vault ready" })).toBeVisible();
    expect(screen.getByLabelText("Vault Passphrase")).toBeVisible();
    await fireEvent.press(screen.getByRole("button", { name: "Unlock Vault" }));
    expect(await screen.findByText("The Vault Passphrase must contain at least three characters.")).toBeVisible();
  });

  it("zeroes the unlocked workspace and returns to the lock ceremony when backgrounded", async () => {
    const workspace = unlockedWorkspace();
    let visibilityListener: ((state: "background") => void) | undefined;
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
      visibilityListener = listener as (state: "background") => void;
      return { remove: jest.fn() };
    });
    jest.spyOn(workspaceModule, "loadMobileVaultWorkspace").mockResolvedValue(workspace);
    const screen = await render(
      <MobilePersonalVault copy={translate("en")} repository={new MobilePersonalVaultRepository(activeTransport)} transport={activeTransport} />,
    );
    await screen.findByRole("header", { name: "Personal Vault ready" });
    await fireEvent.changeText(screen.getByLabelText("Vault Passphrase"), "valid-passphrase");
    await fireEvent.press(screen.getByRole("button", { name: "Unlock Vault" }));
    expect(await screen.findByRole("header", { name: "Personal Vault unlocked" })).toBeVisible();

    await act(() => visibilityListener?.("background"));

    expect(await screen.findByRole("header", { name: "Personal Vault ready" })).toBeVisible();
    expect([...workspace.userRootKey]).toEqual(new Array(32).fill(0));
    expect([...workspace.vaults[0].key]).toEqual(new Array(32).fill(0));
  });

  it("renders equivalent English labels without changing server contracts", async () => {
    const screen = await render(
      <MobilePersonalVault copy={translate("en")} repository={new MobilePersonalVaultRepository(transport)} transport={transport} />,
    );

    expect(await screen.findByRole("header", { name: "Secure your Personal Vault" })).toBeVisible();
    expect(screen.getByLabelText("Vault Name")).toHaveDisplayValue("Personal Vault");
    expect(screen.getByLabelText("Vault Passphrase")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "I saved the Vault Passphrase in a safe place." })).toBeVisible();
  });
});

function unlockedWorkspace(): UnlockedVaultWorkspace {
  return {
    profileId: "profile_1",
    synchronizedAt: "2026-08-11T22:00:00.000Z",
    synchronizationToken: "sync_1",
    syncState: "CURRENT",
    userRootKey: new Uint8Array(32).fill(1),
    vaults: [{
      id: "personal-vault-1",
      name: "Personal Vault",
      type: "PERSONAL",
      role: "OWNER",
      effectiveAccountPermissions: {
        permissions: { canAddAccounts: true, canEditAccounts: true, canDeleteAccounts: true },
        sources: { canAddAccounts: "OWNER", canEditAccounts: "OWNER", canDeleteAccounts: "OWNER" },
      },
      key: new Uint8Array(32).fill(2),
    }],
    accounts: [],
    unavailableAccounts: [],
    unavailableSharedVaults: 0,
  };
}
