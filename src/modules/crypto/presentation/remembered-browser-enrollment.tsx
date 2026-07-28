"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useLocale, useTranslations } from "next-intl";
import { Fingerprint, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { useOnlineStatus } from "@/shared/presentation/use-online-status";
import { formatLocalDateTime } from "@/i18n/format";
import { enrollRememberedBrowser, forgetRememberedBrowser, rememberedBrowserEnrollment, supportsLocalVerification } from "../infrastructure/browser-local-verification";
import { PasskeyPrfUnsupportedError } from "../infrastructure/browser-passkey-prf";

export function RememberedBrowserEnrollment({ profileId, userRootKey }: { profileId: string; userRootKey: Uint8Array }) {
  const t = useTranslations("Crypto.rememberedBrowser");
  const locale = useLocale();
  const online = useOnlineStatus();
  const [status, setStatus] = useState<"checking" | "idle" | "enrolled" | "removed" | "unsupported" | "cancelled" | "offline" | "error">("checking");
  const [enrolledAt, setEnrolledAt] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const enrollmentOperationRef = useRef<AbortController | null>(null);
  const form = useForm({
    defaultValues: {},
    onSubmit: async () => {
      if (!online) { setStatus("offline"); return; }
      if (!supportsLocalVerification()) { setStatus("unsupported"); return; }
      setStatus("idle");
      const controller = new AbortController();
      enrollmentOperationRef.current?.abort();
      enrollmentOperationRef.current = controller;
      try {
        await enrollRememberedBrowser(profileId, userRootKey, controller.signal);
        if (controller.signal.aborted) return;
        setEnrolledAt(new Date().toISOString());
        setStatus("enrolled");
      } catch (error) {
        if (!controller.signal.aborted) setStatus(enrollmentFailureStatus(error));
      } finally {
        if (enrollmentOperationRef.current === controller) enrollmentOperationRef.current = null;
      }
    }
  });

  useEffect(() => {
    let active = true;
    rememberedBrowserEnrollment(profileId)
      .then((enrollment) => {
        if (!active) return;
        setEnrolledAt(enrollment?.enrolledAt ?? null);
        setStatus("idle");
      })
      .catch(() => { if (active) setStatus("error"); });
    return () => { active = false; enrollmentOperationRef.current?.abort(); };
  }, [profileId]);

  async function remove() {
    enrollmentOperationRef.current?.abort();
    setRemoving(true);
    try {
      await forgetRememberedBrowser(profileId);
      setEnrolledAt(null);
      setStatus("removed");
    } catch {
      setStatus("error");
    } finally {
      setRemoving(false);
    }
  }

  return <div className="grid gap-3 border-t border-border pt-4">
    <div><h3 className="font-bold text-foreground">{t("title")}</h3><p className="mt-1 text-sm text-muted-foreground">{t("description")}</p></div>
    <p className="text-xs leading-5 text-muted-foreground">{t("scope")}</p>
    {enrolledAt && <StatusBanner tone="success">{t("enrolledAt", { date: formatLocalDateTime(enrolledAt, locale) })}</StatusBanner>}
    <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
      <form.Subscribe selector={(state) => state.isSubmitting}>{(pending) => <><Button type="submit" variant="outline" disabled={!online || pending || removing || status === "checking"} aria-busy={pending}><Fingerprint />{pending ? t("verifying") : enrolledAt ? t("update") : t("remember")}</Button>{enrolledAt && <Button type="button" variant="ghost" className="text-destructive" disabled={removing || pending} aria-busy={removing} onClick={() => void remove()}><Trash2 />{removing ? t("removing") : t("forget")}</Button>}</>}</form.Subscribe>
    </form>
    {status === "enrolled" && <StatusBanner tone="success">{t("enrolled")}</StatusBanner>}
    {status === "removed" && <StatusBanner tone="success">{t("removed")}</StatusBanner>}
    {status === "cancelled" && <StatusBanner tone="warning">{t("cancelled")}</StatusBanner>}
    {status === "offline" && <StatusBanner tone="offline">{t("offline")}</StatusBanner>}
    {status === "unsupported" && <StatusBanner tone="warning">{t("unsupported")}</StatusBanner>}
    {status === "error" && <StatusBanner tone="danger" role="alert">{t("error")}</StatusBanner>}
  </div>;
}

function enrollmentFailureStatus(error: unknown): "cancelled" | "unsupported" | "error" {
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError")) return "cancelled";
  if (error instanceof DOMException && error.name === "NotSupportedError") return "unsupported";
  if (error instanceof PasskeyPrfUnsupportedError) return "unsupported";
  return "error";
}
