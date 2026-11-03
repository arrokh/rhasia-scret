"use client";

import { useLayoutEffect, useRef } from "react";
import { ArrowLeft, ArrowRight, LockKeyhole, RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";
import type { LandingDeviceKind, LandingPhoneView } from "./landing-phone-mockup";
import {
  AuthenticatorAccountCreator,
  PersonalVaultAccounts,
  PreviewUnlockedVaultWorkspaceProvider,
  SharedVaultCreationWorkspace,
} from "@/modules/authenticator-account";
import type { UnlockedVaultWorkspace } from "@/modules/sync";
import {
  ALL_ACCOUNT_PERMISSIONS,
  effectiveSharedVaultAccountPermissions,
  VaultMembershipDefaults,
  VaultMembershipOwnerPanelPreview,
} from "@/modules/vault-membership";
import type { BrowserVaultParticipant } from "@/modules/vault-membership";
import { AppPage, PageHeader, SurfaceCard } from "@/shared/presentation/app-ui";
import { useLandingPhoneClock } from "./landing-phone-clock";
import styles from "./landing-experience.module.css";

const PERSONAL_VAULT_ID = "landing-preview-personal";
const SHARED_VAULT_ID = "landing-preview-shared";
const MEMBER_KEY = "landing-preview-member";
const HOSTED_VAULT_PREVIEW_ADDRESS = "vaults.example.test/vaults";

const accountFixtures = [
  { issuerKey: "sampleDemoAppName", accountNameKey: "sampleDemoAppAccountName", secretByte: 19 },
  { issuerKey: "sampleExampleCloudName", accountNameKey: "sampleExampleCloudAccountName", secretByte: 47 },
  { issuerKey: "sampleStudioName", accountNameKey: "sampleStudioAccountName", secretByte: 83 },
  { issuerKey: "sampleSandboxName", accountNameKey: "sampleSandboxAccountName", secretByte: 121 },
  { issuerKey: "sampleAddedExampleName", accountNameKey: "sampleAddedExampleAccountName", secretByte: 169 },
] as const;

export function LandingHostedVaultScreen({
  view,
  accountCount,
  deviceKind = "phone",
}: {
  view: LandingPhoneView;
  accountCount?: number;
  deviceKind?: LandingDeviceKind;
}) {
  const currentPhoneTime = useLandingPhoneClock();
  const viewportRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = 0;

    const target = findJourneyControl(viewport, view);
    if (!target) return;
    target.dataset.landingPhoneTarget = view;
    target.classList.add(styles.phoneTargetCue);
    const scrollTarget = view === "sharedPermissions" ? (target.closest<HTMLElement>("form") ?? target) : target;
    const targetBounds = scrollTarget.getBoundingClientRect();
    const viewportBounds = viewport.getBoundingClientRect();
    viewport.scrollTop = Math.max(
      0,
      targetBounds.top - viewportBounds.top - (viewport.clientHeight - targetBounds.height) / 2,
    );
  }, [view]);

  return (
    <div className={styles.phoneUi} data-device-kind={deviceKind}>
      {deviceKind === "laptop" ? (
        <BrowserChrome />
      ) : (
        <>
          <div className={styles.phoneStatusBar}>
            <span>{currentPhoneTime}</span>
            <span className={styles.phoneStatusIcons}>
              <span className={styles.phoneSignal} aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
              <span className={styles.phoneBattery} aria-hidden="true" />
            </span>
          </div>
          {deviceKind === "phone" && (
            <div className={styles.phoneNotch} aria-hidden="true">
              <span />
              <i />
            </div>
          )}
        </>
      )}
      <div ref={viewportRef} className={styles.phoneScreenViewport}>
        <div className={styles.phoneScreenContent} inert>
          <LandingHostedVaultContent view={view} accountCount={accountCount} />
        </div>
      </div>
    </div>
  );
}

function BrowserChrome() {
  return (
    <div className={styles.browserToolbar} aria-hidden="true">
      <div className={styles.browserWindowDots}>
        <i />
        <i />
        <i />
      </div>
      <div className={styles.browserNavigation}>
        <ArrowLeft />
        <ArrowRight />
        <RotateCw />
      </div>
      <div className={styles.browserAddress}>
        <LockKeyhole />
        <span>{HOSTED_VAULT_PREVIEW_ADDRESS}</span>
      </div>
    </div>
  );
}

function findJourneyControl(viewport: HTMLElement, view: LandingPhoneView): HTMLElement | null {
  if (view === "accounts") return viewport.querySelector<HTMLElement>('a[href="/vaults/accounts/new"]');
  if (view === "added")
    return viewport.querySelector<HTMLElement>('[data-slot="account-directory-list"] li:last-child button');
  if (view === "scan") return viewport.querySelector<HTMLElement>('button[class~="w-full"]');
  if (view === "review") return viewport.querySelector<HTMLElement>("#account-label");
  if (view === "sharedCreate") {
    const name = viewport.querySelector<HTMLInputElement>("#shared-vault-name");
    return name?.form?.querySelector<HTMLElement>('button[type="submit"]') ?? null;
  }
  if (view === "sharedInvite") {
    const email = viewport.querySelector<HTMLInputElement>("#invitation-email");
    return email?.form?.querySelector<HTMLElement>('button[type="submit"]') ?? null;
  }
  if (view === "sharedPermissions") return viewport.querySelector<HTMLElement>("#vault-default-canAddAccounts");
  return viewport.querySelector<HTMLElement>('[data-slot="account-directory-list"] li button');
}

function LandingHostedVaultContent({ view, accountCount }: { view: LandingPhoneView; accountCount?: number }) {
  if (view === "accounts" || view === "added")
    return (
      <PersonalAccountsScreen
        key={`${view}-${accountCount ?? "default"}`}
        accountCount={accountCount ?? (view === "added" ? 2 : 1)}
      />
    );
  if (view === "scan" || view === "review") return <AddAccountScreen key={view} review={view === "review"} />;
  if (view === "sharedCreate") return <SharedVaultCreateScreen />;
  if (view === "sharedInvite") return <SharedVaultInviteScreen />;
  if (view === "sharedPermissions") return <SharedVaultPermissionsScreen />;
  return <PersonalAccountsScreen key={view} accountCount={5} includeSharedAccount />;
}

function PersonalAccountsScreen({
  accountCount,
  includeSharedAccount = false,
}: {
  accountCount: number;
  includeSharedAccount?: boolean;
}) {
  const tVault = useTranslations("VaultManagement.vaultsPage");
  const sample = useTranslations("Preview.authenticatorAccounts");
  const workspace = createPreviewWorkspace(
    accountFixtures.slice(0, accountCount).map(({ issuerKey, accountNameKey, secretByte }) => ({
      issuer: sample(issuerKey),
      accountName: sample(accountNameKey),
      secret: syntheticSecret(secretByte),
    })),
    sample("personalVault"),
    includeSharedAccount
      ? {
          vaultName: sample("operations"),
          issuer: sample("sampleStudioName"),
          accountName: sample("sampleTeammateAccountName"),
          secret: syntheticSecret(223),
        }
      : undefined,
  );

  return (
    <PreviewUnlockedVaultWorkspaceProvider initialWorkspace={workspace}>
      <AppPage className={styles.phoneAppPage}>
        <PageHeader className="mb-3" title={tVault("title")} description={tVault("accountsDescription")} />
        <SurfaceCard aria-label={tVault("accountsLabel")}>
          <PersonalVaultAccounts vaultId={PERSONAL_VAULT_ID} previewDensity="compact" previewOnly />
        </SurfaceCard>
      </AppPage>
    </PreviewUnlockedVaultWorkspaceProvider>
  );
}

function AddAccountScreen({ review }: { review: boolean }) {
  const tPages = useTranslations("VaultManagement.pages");
  const sample = useTranslations("Preview.authenticatorAccounts");
  const issuer = sample("sampleDemoAppName");
  const accountName = sample("sampleDemoAppAccountName");
  const initialUri = `otpauth://totp/${encodeURIComponent(`${issuer}:${accountName}`)}?secret=JBSWY3DPEHPK3PXP&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  const workspace = createPreviewWorkspace([], sample("personalVault"));

  return (
    <PreviewUnlockedVaultWorkspaceProvider initialWorkspace={workspace}>
      <AppPage className={styles.phoneAppPage}>
        <PageHeader
          className="mb-3"
          backHref="/vaults"
          backLabel={tPages("backVaults")}
          title={tPages("newAccountTitle")}
          description={tPages("newAccountDescription")}
        />
        <SurfaceCard aria-label={tPages("newAccountLabel")}>
          <AuthenticatorAccountCreator
            personalVaultId={PERSONAL_VAULT_ID}
            preview={review ? { initialUri, initialAccountLabel: accountName } : {}}
          />
        </SurfaceCard>
        <span className="sr-only">{sample("description")}</span>
      </AppPage>
    </PreviewUnlockedVaultWorkspaceProvider>
  );
}

function SharedVaultCreateScreen() {
  const tPages = useTranslations("VaultManagement.pages");
  const tSample = useTranslations("Preview.authenticatorAccounts");
  const workspace = createPreviewWorkspace([], tSample("personalVault"));
  workspace.userEncryptionPublicKey = { kty: "RSA", e: "AQAB", n: "synthetic-preview-only" };

  return (
    <PreviewUnlockedVaultWorkspaceProvider initialWorkspace={workspace}>
      <AppPage className={styles.phoneAppPage}>
        <PageHeader
          className="mb-3"
          backHref="/vaults/manage"
          backLabel={tPages("backDirectory")}
          title={tPages("newSharedTitle")}
          description={tPages("newSharedDescription")}
        />
        <SurfaceCard aria-label={tPages("newSharedLabel")}>
          <div className="p-5 sm:p-6">
            <SharedVaultCreationWorkspace
              personalVaultId={PERSONAL_VAULT_ID}
              previewOnly
              initialName={tSample("operations")}
            />
          </div>
        </SurfaceCard>
      </AppPage>
    </PreviewUnlockedVaultWorkspaceProvider>
  );
}

function SharedVaultInviteScreen() {
  const tPages = useTranslations("VaultManagement.pages");
  const tDetails = useTranslations("VaultManagement.details");
  const tSample = useTranslations("Preview.authenticatorAccounts");
  return (
    <SharedVaultMembershipFrame title={tDetails("invitationsTab")} description={tPages("sharedDescription")}>
      <VaultMembershipOwnerPanelPreview
        vaultId={SHARED_VAULT_ID}
        vaultKey={new Uint8Array(32)}
        vaultKeyVersion={1}
        participants={[]}
        initialEmail={tSample("sampleTeammateAccountName")}
      />
    </SharedVaultMembershipFrame>
  );
}

function SharedVaultPermissionsScreen() {
  const tPages = useTranslations("VaultManagement.pages");
  const tPermissions = useTranslations("VaultManagement.permissions");
  const tSample = useTranslations("Preview.authenticatorAccounts");
  const permissions = { canAddAccounts: true, canEditAccounts: false, canDeleteAccounts: false };
  const effective = effectiveSharedVaultAccountPermissions("VIEWER", permissions, {
    canAddAccounts: null,
    canEditAccounts: null,
    canDeleteAccounts: null,
  });
  const member: BrowserVaultParticipant = {
    key: MEMBER_KEY,
    email: tSample("sampleTeammateAccountName"),
    kind: "MEMBER",
    userId: MEMBER_KEY,
    invitationId: null,
    invitationState: null,
    invitedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
    permissionOverrides: { canAddAccounts: null, canEditAccounts: null, canDeleteAccounts: null },
    effectiveAccountPermissions: effective,
    permissionsRevision: 1,
  };

  return (
    <SharedVaultMembershipFrame title={tPermissions("memberTitle")} description={tPages("sharedDescription")}>
      <div className="grid gap-5">
        <VaultMembershipOwnerPanelPreview
          vaultId={SHARED_VAULT_ID}
          vaultKey={new Uint8Array(32)}
          vaultKeyVersion={1}
          participants={[member]}
        />
        <VaultMembershipDefaults vaultId={SHARED_VAULT_ID} initial={{ permissions, revision: 1 }} readOnlyPreview />
      </div>
    </SharedVaultMembershipFrame>
  );
}

function SharedVaultMembershipFrame({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const tPages = useTranslations("VaultManagement.pages");
  return (
    <AppPage className={styles.phoneAppPage}>
      <PageHeader
        className="mb-3"
        backHref="/vaults/manage"
        backLabel={tPages("backDirectory")}
        title={title}
        description={description}
      />
      <SurfaceCard aria-label={tPages("sharedLabel")}>
        <div className="p-5 sm:p-6">{children}</div>
      </SurfaceCard>
    </AppPage>
  );
}

function createPreviewWorkspace(
  accountInputs: Array<{ issuer: string; accountName: string; secret: Uint8Array }>,
  personalVaultName: string,
  sharedAccount?: { vaultName: string; issuer: string; accountName: string; secret: Uint8Array },
): UnlockedVaultWorkspace {
  const vaultKey = new Uint8Array(32);
  const vault = {
    id: PERSONAL_VAULT_ID,
    name: personalVaultName,
    type: "PERSONAL" as const,
    role: "OWNER" as const,
    effectiveAccountPermissions: effectiveSharedVaultAccountPermissions("OWNER", ALL_ACCOUNT_PERMISSIONS, {
      canAddAccounts: null,
      canEditAccounts: null,
      canDeleteAccounts: null,
    }),
    keyVersion: 1,
    key: vaultKey,
  };
  const sharedPermissions = { canAddAccounts: true, canEditAccounts: false, canDeleteAccounts: false };
  const sharedVault = {
    id: SHARED_VAULT_ID,
    name: sharedAccount?.vaultName ?? "",
    type: "SHARED" as const,
    role: "VIEWER" as const,
    effectiveAccountPermissions: effectiveSharedVaultAccountPermissions("VIEWER", sharedPermissions, {
      canAddAccounts: null,
      canEditAccounts: null,
      canDeleteAccounts: null,
    }),
    keyVersion: 1,
    key: new Uint8Array(32),
  };
  const personalAccounts = accountInputs.map((account, index) => ({
    ...account,
    id: `landing-preview-account-${index + 1}`,
    vaultId: vault.id,
    vaultName: vault.name,
    vaultType: "PERSONAL" as const,
    revision: 1,
    algorithm: "SHA-1" as const,
    digits: 6 as const,
    period: 30,
    tags: [],
  }));
  const accounts: UnlockedVaultWorkspace["accounts"] = sharedAccount
    ? [
        {
          id: "landing-preview-shared-account",
          issuer: sharedAccount.issuer,
          accountName: sharedAccount.accountName,
          secret: sharedAccount.secret,
          vaultId: sharedVault.id,
          vaultName: sharedVault.name,
          vaultType: "SHARED",
          revision: 1,
          algorithm: "SHA-1",
          digits: 6,
          period: 30,
          tags: [],
        },
        ...personalAccounts,
      ]
    : personalAccounts;

  return {
    profileId: "landing-preview-profile",
    synchronizedAt: "2026-01-01T00:00:00.000Z",
    synchronizationToken: "landing-preview-synthetic",
    syncState: "CURRENT",
    userRootKey: new Uint8Array(32),
    vaults: sharedAccount ? [vault, sharedVault] : [vault],
    accounts,
    unavailableAccounts: [],
    unavailableSharedVaults: 0,
    userEncryptionPublicKey: { kty: "RSA", e: "AQAB", n: "synthetic-preview-only" },
  };
}

function syntheticSecret(seed: number): Uint8Array {
  return Uint8Array.from({ length: 20 }, (_, index) => (seed + index * 13) % 256);
}
