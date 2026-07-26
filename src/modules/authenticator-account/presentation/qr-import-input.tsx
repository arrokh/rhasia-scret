"use client";

import { useCallback, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";
import { decodeQrImage, scanQrCamera } from "../infrastructure/browser-qr-importer";

export function QrImportInput({ onUri }: { onUri: (uri: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls | null>(null);
  const [error, setError] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [fileName, setFileName] = useState("");

  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    video.current = element;
    return () => {
      controls.current?.stop();
      controls.current = null;
      video.current = null;
    };
  }, []);

  async function upload(file: File | undefined) {
    if (!file) return;
    try {
      onUri(await decodeQrImage(file));
      setFileName(file.name);
      setError("");
    } catch {
      setError("Tidak dapat membaca kode QR dari gambar tersebut.");
    }
  }

  async function startCamera() {
    if (!video.current) return;
    try {
      controls.current?.stop();
      setCameraActive(true);
      controls.current = await scanQrCamera(video.current, (uri) => {
        controls.current?.stop();
        controls.current = null;
        setCameraActive(false);
        onUri(uri);
        setError("");
      }, () => {
        setCameraActive(false);
        setError("Tidak dapat memindai kode QR dari kamera.");
      });
    } catch {
      setCameraActive(false);
      setError("Akses kamera tidak tersedia. Unggah gambar atau masukkan URI sebagai gantinya.");
    }
  }

  function stopCamera() {
    controls.current?.stop();
    controls.current = null;
    setCameraActive(false);
  }

  return (
    <section className="qr-import-panel" aria-labelledby="qr-import-title">
      <div className="account-section-heading">
        <span className="account-section-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM15 14h2M20 14v3M14 20h3M20 20h.01" /></svg>
        </span>
        <div>
          <h2 id="qr-import-title">Impor kode QR</h2>
          <p>Gunakan gambar dari perangkat atau pindai langsung dengan kamera.</p>
        </div>
      </div>
      <div className="qr-import-actions">
        <label className="qr-action-button" htmlFor="qr-image">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7 9m5-5 5 5M5 14v5h14v-5" /></svg>
          <span>{fileName || "Pilih gambar QR"}</span>
        </label>
        <input className="visually-hidden" id="qr-image" type="file" accept="image/*" onChange={(event) => void upload(event.target.files?.[0])} />
        <button className="qr-action-button" type="button" onClick={() => void (cameraActive ? stopCamera() : startCamera())}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 8 17 5h-5l-2 3H5a2 2 0 0 0-2 2v8h18v-8a2 2 0 0 0-2-2h-4ZM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /></svg>
          <span>{cameraActive ? "Hentikan kamera" : "Pindai dengan kamera"}</span>
        </button>
      </div>
      <div className={`camera-preview${cameraActive ? " is-active" : ""}`} aria-hidden={!cameraActive}>
        <video ref={attachVideo} muted playsInline aria-label="Pratinjau kamera pemindai QR" />
        <span className="camera-guide" aria-hidden="true" />
      </div>
      {error && <p className="qr-import-error" role="alert">{error}</p>}
    </section>
  );
}
