"use client";

import { useCallback, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";
import { useForm } from "@tanstack/react-form";
import { Camera, ImageUp, ScanLine, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBanner, SectionHeading } from "@/shared/presentation/app-ui";
import { FormFieldError, requiredText } from "@/shared/presentation/form-field-error";
import { decodeQrImage, scanQrCamera } from "../infrastructure/browser-qr-importer";

export function QrImportInput({ onUri }: { onUri: (uri: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls | null>(null);
  const [error, setError] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [fileName, setFileName] = useState("");
  const manualForm = useForm({
    defaultValues: { uri: "" },
    onSubmit: ({ value }) => {
      onUri(value.uri.trim());
      manualForm.reset();
      setError("");
    }
  });

  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    video.current = element;
    return () => { controls.current?.stop(); controls.current = null; video.current = null; };
  }, []);

  async function upload(file: File | undefined) {
    if (!file) return;
    try { onUri(await decodeQrImage(file)); setFileName(file.name); setError(""); }
    catch { setError("Tidak dapat membaca kode QR dari gambar tersebut."); }
  }

  async function startCamera() {
    if (!video.current) return;
    try {
      controls.current?.stop(); setCameraActive(true);
      controls.current = await scanQrCamera(video.current, (uri) => { controls.current?.stop(); controls.current = null; setCameraActive(false); onUri(uri); setError(""); }, () => { setCameraActive(false); setError("Tidak dapat memindai kode QR dari kamera."); });
    } catch { setCameraActive(false); setError("Akses kamera tidak tersedia. Unggah gambar atau masukkan URI sebagai gantinya."); }
  }

  function stopCamera() { controls.current?.stop(); controls.current = null; setCameraActive(false); }

  return (
    <section className="grid gap-5 p-5 sm:p-6" aria-labelledby="qr-import-title">
      <SectionHeading icon={ScanLine} title="Impor kode QR" description="Gunakan gambar dari perangkat atau pindai langsung dengan kamera." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Button variant="outline" asChild className="w-full"><label htmlFor="qr-image"><ImageUp /><span className="max-w-[15rem] truncate">{fileName || "Unggah gambar QR"}</span></label></Button>
        <input className="sr-only" id="qr-image" type="file" accept="image/*" onChange={(event) => void upload(event.target.files?.[0])} />
        <Button variant={cameraActive ? "secondary" : "outline"} type="button" onClick={() => void (cameraActive ? stopCamera() : startCamera())}>{cameraActive ? <Square /> : <Camera />}<span>{cameraActive ? "Hentikan kamera" : "Pindai dengan kamera"}</span></Button>
      </div>
      <form noValidate className="grid gap-3 rounded-lg border border-border bg-muted/30 p-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void manualForm.handleSubmit(); }}>
        <manualForm.Field name="uri" validators={{ onSubmit: requiredText("URI autentikator") }}>
          {(field) => <div className="grid gap-2"><Label htmlFor="manual-authenticator-uri">Masukkan URI secara manual</Label><Input id="manual-authenticator-uri" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} placeholder="otpauth://totp/…" autoComplete="off" spellCheck={false} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "manual-authenticator-uri-error" : "manual-authenticator-uri-help"} required /><p id="manual-authenticator-uri-help" className="text-xs leading-5 text-muted-foreground">URI diproses hanya di memori browser dan tidak dikirim ke server.</p><FormFieldError id="manual-authenticator-uri-error" errors={field.state.meta.errors} /></div>}
        </manualForm.Field>
        <manualForm.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <Button variant="outline" type="submit" disabled={isSubmitting}>Gunakan URI manual</Button>}</manualForm.Subscribe>
      </form>
      <div className={`${cameraActive ? "block" : "hidden"} relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-ink-strong sm:aspect-video`} aria-hidden={!cameraActive}>
        <video ref={attachVideo} muted playsInline className="size-full object-cover" aria-label="Pratinjau kamera pemindai QR" />
        <div className="pointer-events-none absolute inset-[16%_20%] rounded-lg border-2 border-card shadow-[0_0_0_999px_rgb(23_29_34/35%)]" aria-hidden="true">
          <span className="absolute top-1/2 left-2 h-0.5 w-[calc(100%-1rem)] -translate-y-1/2 bg-primary shadow-[0_0_8px_rgb(229_167_46/60%)]" />
        </div>
        <p className="absolute right-4 bottom-4 left-4 rounded-md bg-ink-strong/75 px-3 py-2 text-center text-sm text-card">Posisikan kode QR di dalam bingkai</p>
      </div>
      {error && <StatusBanner tone="danger" role="alert">{error}</StatusBanner>}
    </section>
  );
}
