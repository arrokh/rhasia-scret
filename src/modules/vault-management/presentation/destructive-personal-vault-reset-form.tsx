"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { forgetRememberedBrowser, removeAllEncryptedLocalVaultSnapshots } from "@/modules/crypto";
import { DESTRUCTIVE_RESET_CONFIRMATION } from "../application/destructive-personal-vault-reset";

type Status = "idle" | "resetting" | "invalid_confirmation" | "blocked" | "reset_error";

type ResetErrorResponse = {
  error?: string;
  count?: number;
};

export function DestructivePersonalVaultResetForm() {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [blockedVaults, setBlockedVaults] = useState(0);

  async function reset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmation !== DESTRUCTIVE_RESET_CONFIRMATION) {
      setStatus("invalid_confirmation");
      return;
    }

    setStatus("resetting");
    try {
      const response = await fetch("/api/personal-vault/destructive-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation })
      });
      if (!response.ok) {
        const error = await parseError(response);
        if (error.error === "invalid_confirmation") {
          setStatus("invalid_confirmation");
          return;
        }
        if (error.error === "owned_shared_vaults_exist") {
          setBlockedVaults(error.count ?? 0);
          setStatus("blocked");
          return;
        }
        if (error.error === "passkey_recovery_available") {
          router.refresh();
          return;
        }
        throw new Error("Destructive reset failed.");
      }

      forgetRememberedBrowser();
      removeAllEncryptedLocalVaultSnapshots();
      router.replace("/vaults");
      router.refresh();
    } catch {
      setStatus("reset_error");
    }
  }

  return (
    <form className="auth-form destructive-reset-form" onSubmit={reset}>
      <div className="destructive-warning" role="alert">
        <h2>Hapus data terenkripsi dan mulai ulang</h2>
        <p>Ini bukan pemulihan. Tindakan ini tidak dapat dibatalkan dan akan:</p>
        <ul>
          <li>menghapus seluruh akun autentikator di Brankas Pribadi;</li>
          <li>menghapus kunci dan ciphertext yang tidak lagi dapat dibuka;</li>
          <li>mengeluarkan Anda dari Brankas Bersama tempat Anda menjadi Viewer; dan</li>
          <li>mengharuskan Anda mereset 2FA pada layanan asli dan menambahkannya kembali.</li>
        </ul>
        <p>Brankas Bersama milik orang lain dan data anggotanya tidak akan dihapus. Salinan atau secret yang sudah diperoleh browser lain tidak dapat dihapus dari jarak jauh.</p>
      </div>
      <label htmlFor="destructive-reset-confirmation">Ketik <strong>{DESTRUCTIVE_RESET_CONFIRMATION}</strong> untuk melanjutkan</label>
      <input
        id="destructive-reset-confirmation"
        value={confirmation}
        onChange={(event) => {
          setConfirmation(event.target.value);
          if (status !== "resetting") setStatus("idle");
        }}
        autoComplete="off"
        disabled={status === "resetting"}
        required
      />
      <button className="danger-button" type="submit" disabled={status === "resetting"} aria-busy={status === "resetting"}>
        {status === "resetting" ? "Menghapus data brankas…" : "Hapus data dan atur ulang brankas"}
      </button>
      {status !== "resetting" && <Link className="secondary-link" href="/vaults">Batal dan kembali</Link>}
      {status === "invalid_confirmation" && <p className="form-status" role="alert">Frasa konfirmasi tidak cocok.</p>}
      {status === "blocked" && <p className="form-status" role="alert">Reset diblokir karena Anda masih memiliki {blockedVaults} Brankas Bersama aktif.</p>}
      {status === "reset_error" && <p className="form-status" role="alert">Data brankas tidak dapat diatur ulang. Coba lagi.</p>}
    </form>
  );
}

async function parseError(response: Response): Promise<ResetErrorResponse> {
  try {
    return await response.json() as ResetErrorResponse;
  } catch {
    return {};
  }
}
