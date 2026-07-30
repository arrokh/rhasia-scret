"use client";

import { useEffect, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";
import { useForm } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { Camera, CameraOff, ChevronDown, ImageUp, LoaderCircle, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { StatusBanner, SectionHeading } from "@/shared/presentation/app-ui";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { decodeQrImage, scanQrCamera } from "../infrastructure/browser-qr-importer";

type QrError = "imageError" | "cameraError" | "cameraPermissionError" | "cameraNotFoundError" | "cameraBusyError" | "cameraSecureContextError";

const CAMERA_MODAL_READY_DELAY_MS = 500;

export function QrImportInput({ onUri, className }: { onUri: (uri: string) => void; className?: string }) {
  const t = useTranslations("AuthenticatorAccount.qr");
  const controls = useRef<IScannerControls | null>(null);
  const onUriRef = useRef(onUri);
  const [error, setError] = useState<QrError | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [fileName, setFileName] = useState("");
  const manualForm = useForm({
    defaultValues: { uri: "" },
    onSubmit: ({ value }) => {
      onUri(value.uri.trim());
      manualForm.reset();
      setError(null);
    }
  });

  useEffect(() => { onUriRef.current = onUri; }, [onUri]);

  useEffect(() => {
    if (!cameraOpen) return;
    const readyTimer = window.setTimeout(() => setCameraReady(true), CAMERA_MODAL_READY_DELAY_MS);
    return () => window.clearTimeout(readyTimer);
  }, [cameraOpen]);

  useEffect(() => {
    if (!cameraOpen || !cameraReady || !videoElement) return;
    let cancelled = false;
    void scanQrCamera(videoElement, (uri) => {
      if (cancelled) return;
      controls.current?.stop();
      controls.current = null;
      setCameraOpen(false);
      setCameraReady(false);
      setCameraLoading(false);
      setError(null);
      onUriRef.current(uri);
    }).then((scannerControls) => {
      if (cancelled) scannerControls.stop();
      else { controls.current = scannerControls; setCameraLoading(false); }
    }).catch((reason: unknown) => {
      if (!cancelled) { setCameraOpen(false); setCameraReady(false); setCameraLoading(false); setError(classifyCameraError(reason)); }
    });
    return () => { cancelled = true; controls.current?.stop(); controls.current = null; };
  }, [cameraOpen, cameraReady, videoElement]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploadLoading(true);
    try { onUri(await decodeQrImage(file)); setFileName(file.name); setError(null); }
    catch { setError("imageError"); }
    finally { setUploadLoading(false); }
  }

  function openCamera() { setError(null); setCameraReady(false); setCameraLoading(true); setCameraOpen(true); }
  function stopCamera() { controls.current?.stop(); controls.current = null; setCameraOpen(false); setCameraReady(false); setCameraLoading(false); }

  return (
    <section className={cn("grid gap-5 p-5 sm:p-6", className)} aria-labelledby="qr-import-title">
      <SectionHeading icon={ScanLine} title={t("title")} description={t("description")} />
      <Button type="button" className="w-full" disabled={uploadLoading || cameraLoading} aria-busy={cameraLoading} onClick={openCamera}>{cameraLoading ? <LoaderCircle className="animate-spin" /> : <Camera />}<span>{cameraLoading ? t("loadingScanner") : t("scanCamera")}</span></Button>
      <Collapsible className="rounded-lg border border-border bg-muted/30">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" type="button" className="w-full justify-between px-4"><span>{t("advancedOptions")}</span><ChevronDown className="transition-transform [[data-state=open]_&]:rotate-180" aria-hidden="true" /></Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-4 border-t border-border p-4">
          <div className="grid gap-2">
            <Button variant="outline" asChild className="w-full" aria-disabled={uploadLoading}><label htmlFor="qr-image">{uploadLoading ? <LoaderCircle className="animate-spin" /> : <ImageUp />}<span className="max-w-[15rem] truncate">{uploadLoading ? t("loadingScanner") : fileName || t("upload")}</span></label></Button>
            <input className="sr-only" id="qr-image" type="file" accept="image/*" disabled={uploadLoading} onChange={(event) => void upload(event.target.files?.[0])} />
          </div>
          <form noValidate className="grid gap-3" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void manualForm.handleSubmit(); }}>
            <manualForm.Field name="uri" validators={{ onSubmit: ({ value }) => value.trim() ? undefined : t("uriRequired") }}>
              {(field) => <div className="grid gap-2"><Label htmlFor="manual-authenticator-uri">{t("manualLabel")}</Label><Input id="manual-authenticator-uri" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} placeholder="otpauth://totp/…" autoComplete="off" spellCheck={false} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "manual-authenticator-uri-error" : "manual-authenticator-uri-help"} required /><p id="manual-authenticator-uri-help" className="text-xs leading-5 text-muted-foreground">{t("manualHelp")}</p><FormFieldError id="manual-authenticator-uri-error" errors={field.state.meta.errors} /></div>}
            </manualForm.Field>
            <manualForm.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <Button variant="outline" type="submit" disabled={isSubmitting}>{t("useManual")}</Button>}</manualForm.Subscribe>
          </form>
        </CollapsibleContent>
      </Collapsible>
      <Dialog open={cameraOpen} onOpenChange={() => undefined}>
        <DialogContent className="max-w-lg overflow-hidden bg-card p-4" showCloseButton={false} onEscapeKeyDown={(event) => event.preventDefault()} onPointerDownOutside={(event) => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{t("scanCamera")}</DialogTitle>
            <DialogDescription>{t("position")}</DialogDescription>
          </DialogHeader>
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-ink-strong sm:aspect-video">
            {cameraReady && <video ref={setVideoElement} muted playsInline className="size-full object-cover" aria-label={t("cameraPreview")} />}
            {cameraReady && <div className="pointer-events-none absolute inset-[16%_20%] rounded-lg border-2 border-card shadow-[0_0_0_999px_rgb(23_29_34/35%)]" aria-hidden="true">
              <span className="absolute top-1/2 left-2 h-0.5 w-[calc(100%-1rem)] -translate-y-1/2 bg-primary shadow-[0_0_8px_rgb(229_167_46/60%)]" />
            </div>}
            {cameraLoading && <span className="absolute inset-0 grid place-items-center bg-ink-strong/50 text-card" role="status" aria-label={t("loadingScanner")}><LoaderCircle className="size-8 animate-spin" /></span>}
          </div>
          <DialogFooter className="justify-center sm:justify-center"><Button variant="outline" type="button" onClick={stopCamera}><CameraOff />{t("stopCamera")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {error && <StatusBanner tone="danger" role="alert">{t(error)}</StatusBanner>}
    </section>
  );
}

function classifyCameraError(reason: unknown): QrError {
  if (window.isSecureContext === false) return "cameraSecureContextError";
  const name = reason instanceof DOMException || reason instanceof Error ? reason.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "cameraPermissionError";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "cameraNotFoundError";
  if (name === "NotReadableError" || name === "AbortError") return "cameraBusyError";
  return "cameraError";
}
