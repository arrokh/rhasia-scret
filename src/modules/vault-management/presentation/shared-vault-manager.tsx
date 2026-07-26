"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import { FormFieldError, requiredText } from "@/shared/presentation/form-field-error";
import { encryptSharedVaultName } from "../infrastructure/browser-shared-vault-creator";
import { useRenameSharedVaultMutation } from "./hooks/use-shared-vault-mutations";
import { SharedVaultCreator } from "./shared-vault-creator";

type SharedVaultAccountSummary = {
  id: string;
  issuer: string;
  accountName: string;
  revision: number;
};

type SharedVaultSummary = {
  id: string;
  name: string;
  role: "OWNER" | "VIEWER";
  key: Uint8Array;
  accounts: SharedVaultAccountSummary[];
};

export function SharedVaultManager({
  userRootKey,
  vaults,
  onVaultCreated,
  onVaultRenamed,
  onAccountDeleted
}: {
  userRootKey: Uint8Array;
  vaults: SharedVaultSummary[];
  onVaultCreated: (vault: { id: string; name: string; key: Uint8Array }) => void;
  onVaultRenamed: (vaultId: string, name: string) => void;
  onAccountDeleted: (vaultId: string, accountId: string, expectedRevision: number) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedVaultId, setSelectedVaultId] = useState<string | null>(null);
  const selectedVault = vaults.find((vault) => vault.id === selectedVaultId) ?? null;

  return (
    <>
      <button className="secondary-button" type="button" onClick={() => setOpen(true)}>
        Brankas Bersama
      </button>
      {open && (
        <SharedVaultDialog
          creating={creating}
          selectedVault={selectedVault}
          userRootKey={userRootKey}
          vaults={vaults}
          onCreate={() => setCreating(true)}
          onCreated={(vault) => {
            onVaultCreated(vault);
            setCreating(false);
            setSelectedVaultId(vault.id);
          }}
          onSelect={setSelectedVaultId}
          onBack={() => {
            setCreating(false);
            setSelectedVaultId(null);
          }}
          onVaultRenamed={onVaultRenamed}
          onAccountDeleted={onAccountDeleted}
          onClose={() => {
            setCreating(false);
            setSelectedVaultId(null);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function SharedVaultDialog({
  creating,
  selectedVault,
  userRootKey,
  vaults,
  onCreate,
  onCreated,
  onSelect,
  onBack,
  onVaultRenamed,
  onAccountDeleted,
  onClose
}: {
  creating: boolean;
  selectedVault: SharedVaultSummary | null;
  userRootKey: Uint8Array;
  vaults: SharedVaultSummary[];
  onCreate: () => void;
  onCreated: (vault: { id: string; name: string; key: Uint8Array }) => void;
  onSelect: (vaultId: string) => void;
  onBack: () => void;
  onVaultRenamed: (vaultId: string, name: string) => void;
  onAccountDeleted: (vaultId: string, accountId: string, expectedRevision: number) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const openDialog = useCallback((element: HTMLDialogElement | null) => {
    dialog.current = element;
    if (element && !element.open) element.showModal();
  }, []);
  const showingDetail = creating || selectedVault !== null;

  return (
    <dialog
      ref={openDialog}
      className="vault-dialog shared-vault-dialog"
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
      onClose={onClose}
      onCancel={onClose}
    >
      <div className="dialog-heading">
        <div>
          <p className="eyebrow">BERBAGI</p>
          <h2>{creating ? "Buat Brankas Bersama" : selectedVault?.name ?? "Brankas Bersama"}</h2>
        </div>
        <div className="dialog-actions">
          {showingDetail && <button className="icon-button" type="button" aria-label="Kembali ke daftar Brankas Bersama" onClick={onBack}><BackIcon /></button>}
          {!showingDetail && <button className="icon-button" type="button" aria-label="Buat Brankas Bersama" onClick={onCreate}><PlusIcon /></button>}
          <button className="icon-button" type="button" aria-label="Tutup daftar Brankas Bersama" onClick={() => dialog.current?.close()}><CloseIcon /></button>
        </div>
      </div>
      {creating ? (
        <SharedVaultCreator userRootKey={userRootKey} onCreated={onCreated} onCancel={onBack} />
      ) : selectedVault ? (
        <SharedVaultDetails vault={selectedVault} onRenamed={onVaultRenamed} onAccountDeleted={onAccountDeleted} />
      ) : vaults.length ? (
        <ul className="shared-vault-list">
          {vaults.map((vault) => (
            <li key={vault.id}>
              <button className="shared-vault-select" type="button" onClick={() => onSelect(vault.id)}>
                <span className="vault-list-icon" aria-hidden="true">⌘</span>
                <span><strong>{vault.name}</strong><small>{vault.role === "OWNER" ? "Pemilik" : "Anggota"}</small></span>
                <ChevronIcon />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-accounts">Belum ada Brankas Bersama. Gunakan tombol tambah untuk membuatnya.</p>
      )}
    </dialog>
  );
}

function SharedVaultDetails({
  vault,
  onRenamed,
  onAccountDeleted
}: {
  vault: SharedVaultSummary;
  onRenamed: (vaultId: string, name: string) => void;
  onAccountDeleted: (vaultId: string, accountId: string, expectedRevision: number) => Promise<void>;
}) {
  const [status, setStatus] = useState("");
  const [accountToDelete, setAccountToDelete] = useState<SharedVaultAccountSummary | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const renameMutation = useRenameSharedVaultMutation();
  const renameForm = useForm({
    defaultValues: { name: vault.name },
    onSubmit: async ({ value }) => {
      try {
        const name = value.name.trim();
        const encryptedName = await encryptSharedVaultName(vault.key, name);
        await renameMutation.mutateAsync({ vaultId: vault.id, encryptedName: bytesToBase64(encryptedName) });
        onRenamed(vault.id, name);
        setStatus("Nama brankas diperbarui.");
      } catch {
        setStatus("Tidak dapat memperbarui nama brankas.");
      }
    }
  });

  async function removeAccount(account: SharedVaultAccountSummary) {
    setStatus("");
    setDeletingAccount(true);
    try {
      await onAccountDeleted(vault.id, account.id, account.revision);
      setAccountToDelete(null);
      setStatus("Akun autentikator dihapus.");
    } catch {
      setStatus("Tidak dapat menghapus akun autentikator.");
    } finally {
      setDeletingAccount(false);
    }
  }

  return (
    <div className="shared-vault-details">
      {vault.role === "OWNER" ? (
        <form noValidate className="auth-form shared-vault-rename-form" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void renameForm.handleSubmit(); }}>
          <renameForm.Field name="name" validators={{ onSubmit: requiredText("Nama Brankas Bersama") }}>
            {(field) => <div className="account-field"><label htmlFor={`shared-vault-name-${vault.id}`}>Nama Brankas Bersama</label><div className="inline-edit-field"><input id={`shared-vault-name-${vault.id}`} value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? `shared-vault-name-${vault.id}-error` : undefined} required /><button className="secondary-button" type="submit" disabled={renameMutation.isPending}>{renameMutation.isPending ? "Menyimpan…" : "Simpan"}</button></div><FormFieldError id={`shared-vault-name-${vault.id}-error`} errors={field.state.meta.errors} /></div>}
          </renameForm.Field>
        </form>
      ) : <p className="form-status">Anda memiliki akses baca ke brankas ini.</p>}

      <div className="shared-vault-account-heading">
        <div><p className="eyebrow">AKUN</p><h3>Akun autentikator</h3></div>
        {vault.role === "OWNER" && <Link className="add-account-link" href={`/vaults/accounts/new?vaultId=${encodeURIComponent(vault.id)}`}><PlusIcon /><span>Tambah akun</span></Link>}
      </div>
      {vault.accounts.length ? (
        <ul className="shared-vault-account-list">
          {vault.accounts.map((account) => (
            <li key={account.id}>
              <span className="account-avatar" aria-hidden="true">{account.issuer.slice(0, 1).toUpperCase()}</span>
              <span className="account-copy"><strong>{account.issuer}</strong><span>{account.accountName}</span></span>
              {vault.role === "OWNER" && <button className="icon-button" type="button" aria-label={`Hapus ${account.issuer} ${account.accountName}`} onClick={() => setAccountToDelete(account)}><TrashIcon /></button>}
            </li>
          ))}
        </ul>
      ) : <p className="empty-accounts">Belum ada akun autentikator di brankas ini.</p>}
      {status && <p className="form-status" role="status">{status}</p>}
      {accountToDelete && (
        <ConfirmationDialog
          title="Hapus akun autentikator?"
          description={`${accountToDelete.issuer} (${accountToDelete.accountName}) akan dihapus dari ${vault.name}. Akun dapat dipulihkan selama masa pemulihan.`}
          confirmLabel="Hapus akun"
          danger
          pending={deletingAccount}
          onCancel={() => setAccountToDelete(null)}
          onConfirm={() => void removeAccount(accountToDelete)}
        />
      )}
    </div>
  );
}

function PlusIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>; }
function BackIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>; }
function CloseIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>; }
function ChevronIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>; }
function TrashIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg>; }
