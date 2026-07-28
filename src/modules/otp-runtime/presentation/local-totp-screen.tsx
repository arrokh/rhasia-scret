"use client";

import { useEffect, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppPage, PageHeader, StatusBanner, SurfaceCard } from "@/shared/presentation/app-ui";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { generateTotp } from "../application/generate-totp";
import { hasClockDrift } from "../domain/clock-drift";
import { parseTotpUri, TotpConfigurationError, type TotpConfiguration, type TotpConfigurationErrorCode } from "../domain/totp-configuration";
import { BrowserHmacGenerator } from "../infrastructure/browser-hmac-generator";
import { useServerTimeQuery } from "./hooks/use-server-time-query";

export function LocalTotpScreen() {
  const t = useTranslations("OtpRuntime.local");
  const tError = useTranslations("OtpRuntime.errors");
  const [configuration, setConfiguration] = useState<TotpConfiguration | null>(null);
  const [code, setCode] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<TotpConfigurationErrorCode | "generation" | "copy" | null>(null);
  const [copied, setCopied] = useState(false);
  const serverTime = useServerTimeQuery(configuration !== null);
  const clockDriftWarning = serverTime.data ? hasClockDrift(new Date(), serverTime.data) : false;
  const form = useForm({ defaultValues: { uri: "" }, onSubmit: ({ value }) => { try { setConfiguration(parseTotpUri(value.uri)); setError(null); } catch (reason) { setConfiguration(null); setCode(""); setError(reason instanceof TotpConfigurationError ? reason.code : "invalidUri"); } } });

  useEffect(() => {
    if (!configuration) return;
    let cancelled = false;
    const update = async () => { try { const next = await generateTotp(configuration, new BrowserHmacGenerator()); if (cancelled) return; setCode((current) => { if (current !== next.value) setCopied(false); return next.value; }); setSeconds(Math.max(0, Math.ceil((next.validUntil.getTime() - Date.now()) / 1_000))); } catch { if (!cancelled) setError("generation"); } };
    void update(); const interval = window.setInterval(() => { void update(); }, 1_000); return () => { cancelled = true; window.clearInterval(interval); };
  }, [configuration]);

  async function copyCode() { if (!code) return; try { await navigator.clipboard.writeText(code); setCopied(true); } catch { setError("copy"); } }

  return <AppPage><PageHeader title={t("title")} description={t("description")} /><SurfaceCard className="grid gap-6 p-5 sm:p-7">
    <form noValidate className="grid gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}><form.Field name="uri" validators={{ onSubmit: ({ value }) => value.trim() ? undefined : t("uriRequired") }}>{(field) => <div className="grid gap-2"><Label htmlFor="totp-uri">{t("uri")}</Label><Input id="totp-uri" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} autoComplete="off" aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "totp-uri-error" : undefined} required /><FormFieldError id="totp-uri-error" errors={field.state.meta.errors} /></div>}</form.Field><Button type="submit">{t("generate")}</Button></form>
    {error && <StatusBanner tone="danger" role="alert">{error === "generation" ? t("generationError") : error === "copy" ? t("copyError") : tError(error)}</StatusBanner>}
    {clockDriftWarning && <StatusBanner tone="warning" role="alert">{t("clockDrift")}</StatusBanner>}
    {configuration && <section className="grid justify-items-center gap-3 rounded-lg border bg-muted/40 p-5"><div className="text-center"><h2 id="totp-title" className="font-bold text-ink-strong">{configuration.issuer}</h2><p className="text-sm text-muted-foreground">{configuration.accountName}</p></div><output className="font-mono text-4xl leading-10 font-semibold text-ink-strong" aria-label={t("current")}>{formatOtp(code)}</output><p className="text-sm text-muted-foreground">{t("remaining", { seconds })}</p><Button className="w-full" type="button" onClick={() => void copyCode()}><Copy />{copied ? t("copied") : t("copy")}</Button><span className="sr-only" aria-live="polite">{copied ? t("copied") : ""}</span></section>}
  </SurfaceCard></AppPage>;
}

function formatOtp(code: string) { if (!code) return "••• •••"; const middle = Math.ceil(code.length / 2); return `${code.slice(0, middle)} ${code.slice(middle)}`; }
