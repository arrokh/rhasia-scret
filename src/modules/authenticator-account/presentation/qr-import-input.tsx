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
      setError("Unable to read a QR code from that image.");
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
      }, () => setError("Unable to scan a QR code from the camera."));
    } catch {
      setError("Camera access is unavailable. Upload an image or enter a URI instead.");
    }
  }

  return <section><h3>Import QR code</h3><label htmlFor="qr-image">Upload QR image</label><input id="qr-image" type="file" accept="image/*" onChange={(event) => void upload(event.target.files?.[0])} /><button type="button" onClick={() => void startCamera()}>Scan with camera</button><video ref={video} muted playsInline />{error && <p role="alert">{error}</p>}</section>;
}
