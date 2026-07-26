"use client";

import { useEffect, useRef, useState } from "react";
import { SharedVaultCreator } from "./shared-vault-creator";

type SharedVaultSummary = { id: string; name: string; role: "OWNER" | "VIEWER" };

export function SharedVaultManager({
  userRootKey,
  vaults
}: {
  userRootKey: Uint8Array;
  vaults: SharedVaultSummary[];
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sharedVaults, setSharedVaults] = useState(vaults);

  return (
    <>
      <button className="secondary-button" type="button" onClick={() => setOpen(true)}>
        Brankas Bersama
      </button>
      {open && (
        <SharedVaultDialog
          creating={creating}
          setCreating={setCreating}
          userRootKey={userRootKey}
          vaults={sharedVaults}
          onCreated={(vault) => {
            setSharedVaults((current) => [...current, { ...vault, role: "OWNER" }]);
            setCreating(false);
          }}
          onClose={() => {
            setCreating(false);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function SharedVaultDialog({
  creating,
  setCreating,
  userRootKey,
  vaults,
  onCreated,
  onClose
}: {
  creating: boolean;
  setCreating: (creating: boolean) => void;
  userRootKey: Uint8Array;
  vaults: SharedVaultSummary[];
  onCreated: (vault: { id: string; name: string }) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog ref={dialog} className="vault-dialog" onClose={onClose} onCancel={onClose}>
      <div className="dialog-heading">
        <div>
          <p className="eyebrow">BERBAGI</p>
          <h2>{creating ? "Buat Brankas Bersama" : "Brankas Bersama"}</h2>
        </div>
        <div className="dialog-actions">
          {!creating && (
            <button className="icon-button" type="button" aria-label="Buat Brankas Bersama" onClick={() => setCreating(true)}>
              <PlusIcon />
            </button>
          )}
          <button className="icon-button" type="button" aria-label="Tutup daftar Brankas Bersama" onClick={() => dialog.current?.close()}>
            <CloseIcon />
          </button>
        </div>
      </div>
      {creating ? (
        <SharedVaultCreator userRootKey={userRootKey} onCreated={onCreated} onCancel={() => setCreating(false)} />
      ) : vaults.length ? (
        <ul className="shared-vault-list">
          {vaults.map((vault) => (
            <li key={vault.id}>
              <span className="vault-list-icon" aria-hidden="true">⌘</span>
              <span><strong>{vault.name}</strong><small>{vault.role === "OWNER" ? "Pemilik" : "Anggota"}</small></span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-accounts">Belum ada Brankas Bersama. Gunakan tombol tambah untuk membuatnya.</p>
      )}
    </dialog>
  );
}

function PlusIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
}

function CloseIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>;
}
