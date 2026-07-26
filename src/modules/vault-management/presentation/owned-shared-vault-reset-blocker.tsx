"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import { useDeleteSharedVaultMutation } from "./hooks/use-shared-vault-mutations";

export function OwnedSharedVaultResetBlocker({ vaultIds }: { vaultIds: string[] }) {
  const router = useRouter();
  const deleteMutation = useDeleteSharedVaultMutation();
  const [vaultToDelete, setVaultToDelete] = useState<string | null>(null);
  function deleteVault(vaultId: string) { deleteMutation.mutate(vaultId, { onSuccess: () => { setVaultToDelete(null); router.refresh(); } }); }

  return <div className="grid gap-5">
    <StatusBanner tone="danger" title="Reset destruktif diblokir" role="alert"><p>Anda masih menjadi pemilik {vaultIds.length} Brankas Bersama aktif. Reset diblokir agar brankas dan anggotanya tidak kehilangan pemilik tanpa peringatan.</p><p className="mt-2">Hapus setiap Brankas Bersama di bawah terlebih dahulu. Semua anggota akan langsung kehilangan akses.</p></StatusBanner>
    <ul className="grid list-none gap-2 p-0">{vaultIds.map((vaultId, index) => <li key={vaultId} className="flex min-h-16 items-center justify-between gap-3 rounded-md border border-destructive/20 bg-danger-surface/50 p-3"><span className="font-bold text-destructive">Brankas Bersama {index + 1}</span><Button variant="destructive" size="sm" type="button" disabled={deleteMutation.isPending} aria-busy={deleteMutation.isPending && deleteMutation.variables === vaultId} onClick={() => setVaultToDelete(vaultId)}><Trash2 />{deleteMutation.isPending && deleteMutation.variables === vaultId ? "Menghapus…" : "Hapus brankas"}</Button></li>)}</ul>
    <Button variant="outline" asChild><Link href="/vaults">Batal dan kembali</Link></Button>
    {deleteMutation.isError && <StatusBanner tone="danger" role="alert">Brankas Bersama tidak dapat dihapus. Coba lagi.</StatusBanner>}
    {vaultToDelete && <ConfirmationDialog title="Hapus Brankas Bersama?" description="Semua anggota akan langsung kehilangan akses. Brankas memasuki masa pemulihan 30 hari sebelum dihapus permanen." confirmLabel="Hapus brankas" danger pending={deleteMutation.isPending} onCancel={() => setVaultToDelete(null)} onConfirm={() => deleteVault(vaultToDelete)} />}
  </div>;
}
