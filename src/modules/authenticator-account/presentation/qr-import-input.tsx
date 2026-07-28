"use client";

import { useCallback, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";
import { useForm } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { Camera, ImageUp, LoaderCircle, ScanLine, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBanner, SectionHeading } from "@/shared/presentation/app-ui";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { decodeQrImage, scanQrCamera } from "../infrastructure/browser-qr-importer";

type QrError = "imageError" | "scanError" | "cameraError";

export function QrImportInput({ onUri }: { onUri: (uri: string) => void }) {
  const t = useTranslations("AuthenticatorAccount.qr");
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls | null>(null);
  const [error, setError] = useState<QrError | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [scannerLoading, setScannerLoading] = useState(false);
  const [fileName, setFileName] = useState("");
  const manualForm = useForm({
    defaultValues: { uri: "" },
    onSubmit: ({ value }) => {
      onUri(value.uri.trim());
      manualForm.reset();
      setError(null);
    }
  });

  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    video.current = element;
    return () => { controls.current?.stop(); controls.current = null; video.current = null; };
  }, []);

  async function upload(file: File | undefined) {
    if (!file) return;
    setScannerLoading(true);
    try { onUri(await decodeQrImage(file)); setFileName(file.name); setError(null); }
    catch { setError("imageError"); }
    finally { setScannerLoading(false); }
  }

  async function startCamera() {
    if (!video.current) return;
    setScannerLoading(true);
    try {
      controls.current?.stop(); setCameraActive(true);
      controls.current = await scanQrCamera(video.current, (uri) => { controls.current?.stop(); controls.current = null; setCameraActive(false); onUri(uri); setError(null); }, () => { setCameraActive(false); setError("scanError"); });
    } catch { setCameraActive(false); setError("cameraError"); }
    finally { setScannerLoading(false); }
  }

  function stopCamera() { controls.current?.stop(); controls.current = null; setCameraActive(false); }

  return (
    <section className="grid gap-5 p-5 sm:p-6" aria-labelledby="qr-import-title">
      <SectionHeading icon={ScanLine} title={t("title")} description={t("description")} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Button variant="outline" asChild className="w-full" aria-disabled={scannerLoading}><label htmlFor="qr-image">{scannerLoading ? <LoaderCircle className="animate-spin" /> : <ImageUp />}<span className="max-w-[15rem] truncate">{scannerLoading ? t("loadingScanner") : fileName || t("upload")}</span></label></Button>
        <input className="sr-only" id="qr-image" type="file" accept="image/*" disabled={scannerLoading} onChange={(event) => void upload(event.target.files?.[0])} />
        <Button variant={cameraActive ? "secondary" : "outline"} type="button" disabled={scannerLoading} aria-busy={scannerLoading} onClick={() => void (cameraActive ? stopCamera() : startCamera())}>{scannerLoading ? <LoaderCircle className="animate-spin" /> : cameraActive ? <Square /> : <Camera />}<span>{scannerLoading ? t("loadingScanner") : cameraActive ? t("stopCamera") : t("scanCamera")}</span></Button>
      </div>
      <form noValidate className="grid gap-3 rounded-lg border border-border bg-muted/30 p-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void manualForm.handleSubmit(); }}>
        <manualForm.Field name="uri" validators={{ onSubmit: ({ value }) => value.trim() ? undefined : t("uriRequired") }}>
          {(field) => <div className="grid gap-2"><Label htmlFor="manual-authenticator-uri">{t("manualLabel")}</Label><Input id="manual-authenticator-uri" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} placeholder="otpauth://totp/…" autoComplete="off" spellCheck={false} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "manual-authenticator-uri-error" : "manual-authenticator-uri-help"} required /><p id="manual-authenticator-uri-help" className="text-xs leading-5 text-muted-foreground">{t("manualHelp")}</p><FormFieldError id="manual-authenticator-uri-error" errors={field.state.meta.errors} /></div>}
        </manualForm.Field>
        <manualForm.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <Button variant="outline" type="submit" disabled={isSubmitting}>{t("useManual")}</Button>}</manualForm.Subscribe>
      </form>
      <div className={`${cameraActive ? "block" : "hidden"} relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-ink-strong sm:aspect-video`} aria-hidden={!cameraActive}>
        <video ref={attachVideo} muted playsInline className="size-full object-cover" aria-label={t("cameraPreview")} />
        <div className="pointer-events-none absolute inset-[16%_20%] rounded-lg border-2 border-card shadow-[0_0_0_999px_rgb(23_29_34/35%)]" aria-hidden="true">
          <span className="absolute top-1/2 left-2 h-0.5 w-[calc(100%-1rem)] -translate-y-1/2 bg-primary shadow-[0_0_8px_rgb(229_167_46/60%)]" />
        </div>
        <p className="absolute right-4 bottom-4 left-4 rounded-md bg-ink-strong/75 px-3 py-2 text-center text-sm text-card">{t("position")}</p>
      </div>
      {error && <StatusBanner tone="danger" role="alert">{t(error)}</StatusBanner>}
    </section>
  );
}
