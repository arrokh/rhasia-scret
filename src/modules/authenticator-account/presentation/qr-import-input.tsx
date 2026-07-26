"use client";

import { useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";
import { decodeQrImage, scanQrCamera } from "../infrastructure/browser-qr-importer";

export function QrImportInput({ onUri }: { onUri: (uri: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls | null>(null);
  const [error, setError] = useState("");

  async function upload(file: File | undefined) {
    if (!file) return;
    try {
      onUri(await decodeQrImage(file));
      setError("");
    } catch {
      setError("Tidak dapat membaca kode QR dari gambar tersebut.");
    }
  }

  async function startCamera() {
    if (!video.current) return;
    try {
      controls.current?.stop();
      controls.current = await scanQrCamera(video.current, (uri) => {
        controls.current?.stop();
        controls.current = null;
        onUri(uri);
        setError("");
      }, () => setError("Tidak dapat memindai kode QR dari kamera."));
    } catch {
      setError("Akses kamera tidak tersedia. Unggah gambar atau masukkan URI sebagai gantinya.");
    }
  }

  return <section><h3>Impor kode QR</h3><label htmlFor="qr-image">Unggah gambar QR</label><input id="qr-image" type="file" accept="image/*" onChange={(event) => void upload(event.target.files?.[0])} /><button type="button" onClick={() => void startCamera()}>Pindai dengan kamera</button><video ref={video} muted playsInline />{error && <p role="alert">{error}</p>}</section>;
}
