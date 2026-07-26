"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import { useDeleteSharedVaultMutation } from "./hooks/use-shared-vault-mutations";

export function OwnedSharedVaultResetBlocker({ vaultIds }: { vaultIds: string[] }) {
  const router = useRouter();
  const deleteMutation = useDeleteSharedVaultMutation();
  const [vaultToDelete, setVaultToDelete] = useState<string | null>(null);

  function deleteVault(vaultId: string) {
    deleteMutation.mutate(vaultId, { onSuccess: () => { setVaultToDelete(null); router.refresh(); } });
  }

  return (
    <div className="recovery-unavailable destructive-reset-form">
      <div className="destructive-warning" role="alert">
        <h2>Reset destruktif diblokir</h2>
        <p>Anda masih menjadi owner {vaultIds.length} Brankas Bersama aktif. Reset diblokir agar brankas dan anggotanya tidak kehilangan owner tanpa peringatan.</p>
        <p>Hapus setiap Brankas Bersama di bawah terlebih dahulu. Semua anggota akan langsung kehilangan akses. Setelah Passphrase Brankas di-reset, ciphertext lama tidak dapat dipulihkan atau dibuka kembali.</p>
      </div>
      <ul className="owned-vault-reset-list">
        {vaultIds.map((vaultId, index) => (
          <li key={vaultId}>
            <span>Brankas Bersama {index + 1}</span>
            <button
              className="danger-button"
              type="button"
              disabled={deleteMutation.isPending}
              aria-busy={deleteMutation.isPending && deleteMutation.variables === vaultId}
              onClick={() => setVaultToDelete(vaultId)}
            >
              {deleteMutation.isPending && deleteMutation.variables === vaultId ? "Menghapus…" : "Hapus brankas"}
            </button>
          </li>
        ))}
      </ul>
      <Link className="secondary-link" href="/vaults">Batal dan kembali</Link>
      {deleteMutation.isError && <p className="form-status" role="alert">Brankas Bersama tidak dapat dihapus. Coba lagi.</p>}
      {vaultToDelete && (
        <ConfirmationDialog
          title="Hapus Brankas Bersama?"
          description="Semua anggota akan langsung kehilangan akses. Brankas memasuki masa pemulihan 30 hari sebelum dihapus permanen."
          confirmLabel="Hapus brankas"
          danger
          pending={deleteMutation.isPending}
          onCancel={() => setVaultToDelete(null)}
          onConfirm={() => deleteVault(vaultToDelete)}
        />
      )}
    </div>
  );
}
