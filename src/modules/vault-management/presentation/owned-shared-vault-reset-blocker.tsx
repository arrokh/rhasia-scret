"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function OwnedSharedVaultResetBlocker({ vaultIds }: { vaultIds: string[] }) {
  const router = useRouter();
  const [deletingVaultId, setDeletingVaultId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function deleteVault(vaultId: string) {
    setDeletingVaultId(vaultId);
    setError("");
    try {
      const response = await fetch(`/api/shared-vaults/${vaultId}/lifecycle`, { method: "DELETE" });
      if (!response.ok) throw new Error("Shared Vault deletion failed.");
      router.refresh();
    } catch {
      setError("Brankas Bersama tidak dapat dihapus. Coba lagi.");
      setDeletingVaultId(null);
    }
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
              disabled={deletingVaultId !== null}
              aria-busy={deletingVaultId === vaultId}
              onClick={() => void deleteVault(vaultId)}
            >
              {deletingVaultId === vaultId ? "Menghapus…" : "Hapus brankas"}
            </button>
          </li>
        ))}
      </ul>
      <Link className="secondary-link" href="/vaults">Batal dan kembali</Link>
      {error && <p className="form-status" role="alert">{error}</p>}
    </div>
  );
}
