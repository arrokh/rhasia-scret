"use client";

import { useState } from "react";
import { enrollPasskeyRecovery } from "../infrastructure/browser-passkey-recovery-workflow";

export function PasskeyRecoveryEnrollment({ userRootKey }: { userRootKey: Uint8Array }) {
  const [status, setStatus] = useState<"idle" | "enrolling" | "success" | "error">("idle");

  async function enroll() {
    setStatus("enrolling");
    try {
      await enrollPasskeyRecovery(userRootKey);
      setStatus("success");
    } catch {
      setStatus("error");
    }
  }

  return (
    <section className="passkey-recovery">
      <p>Pemulihan kunci akses opsional melindungi paket pemulihan terenkripsi; layanan tidak pernah menerima kunci brankas yang dapat digunakan.</p>
      <button className="primary-button" type="button" onClick={() => void enroll()} disabled={status === "enrolling"} aria-busy={status === "enrolling"}>
        {status === "enrolling" ? "Membuat pemulihan kunci akses…" : "Aktifkan pemulihan kunci akses"}
      </button>
      <p aria-live="polite">
        {status === "success" && "Pemulihan kunci akses diaktifkan di perangkat ini."}
        {status === "error" && "Tidak dapat mengaktifkan pemulihan kunci akses. Browser ini harus mendukung PRF WebAuthn."}
      </p>
    </section>
  );
}
