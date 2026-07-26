"use client";

import { useEffect, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppPage, SectionHeading, StatusBanner, SurfaceCard } from "@/shared/presentation/app-ui";
import { FormFieldError, requiredText } from "@/shared/presentation/form-field-error";
import { generateTotp } from "../application/generate-totp";
import { hasClockDrift } from "../domain/clock-drift";
import { parseTotpUri, type TotpConfiguration } from "../domain/totp-configuration";
import { BrowserHmacGenerator } from "../infrastructure/browser-hmac-generator";
import { useServerTimeQuery } from "./hooks/use-server-time-query";

export function LocalTotpScreen() {
  const [configuration, setConfiguration] = useState<TotpConfiguration | null>(null);
  const [code, setCode] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const serverTime = useServerTimeQuery(configuration !== null);
  const clockDriftWarning = serverTime.data ? hasClockDrift(new Date(), serverTime.data) : false;
  const form = useForm({ defaultValues: { uri: "" }, onSubmit: ({ value }) => { try { setConfiguration(parseTotpUri(value.uri)); setError(""); } catch (reason) { setConfiguration(null); setCode(""); setError(reason instanceof Error ? reason.message : "URI autentikator tidak valid."); } } });

  useEffect(() => {
    if (!configuration) return;
    let cancelled = false;
    const update = async () => { try { const next = await generateTotp(configuration, new BrowserHmacGenerator()); if (cancelled) return; setCode((current) => { if (current !== next.value) setCopied(false); return next.value; }); setSeconds(Math.max(0, Math.ceil((next.validUntil.getTime() - Date.now()) / 1_000))); } catch { if (!cancelled) setError("Tidak dapat membuat OTP di browser ini."); } };
    void update(); const interval = window.setInterval(() => { void update(); }, 1_000); return () => { cancelled = true; window.clearInterval(interval); };
  }, [configuration]);

  async function copyCode() { if (!code) return; try { await navigator.clipboard.writeText(code); setCopied(true); } catch { setError("OTP tidak dapat disalin."); } }

  return <AppPage centered><SurfaceCard className="grid w-full max-w-md gap-6 p-5 sm:p-7" aria-labelledby="totp-title">
    <SectionHeading icon={KeyRound} title="TOTP Lokal" description="Tempel URI TOTP yang didukung. URI diproses dan hanya digunakan di browser ini." />
    <form noValidate className="grid gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}><form.Field name="uri" validators={{ onSubmit: requiredText("URI autentikator") }}>{(field) => <div className="grid gap-2"><Label htmlFor="totp-uri">URI autentikator</Label><Input id="totp-uri" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} autoComplete="off" aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "totp-uri-error" : undefined} required /><FormFieldError id="totp-uri-error" errors={field.state.meta.errors} /></div>}</form.Field><Button type="submit">Buat kode</Button></form>
    {error && <StatusBanner tone="danger" role="alert">{error}</StatusBanner>}
    {clockDriftWarning && <StatusBanner tone="warning" role="alert">Waktu perangkat Anda berbeda lebih dari 30 detik dari server. Kode mungkin gagal.</StatusBanner>}
    {configuration && <section className="grid justify-items-center gap-3 rounded-lg border bg-muted/40 p-5"><div className="text-center"><h2 id="totp-title" className="font-bold text-ink-strong">{configuration.issuer}</h2><p className="text-sm text-muted-foreground">{configuration.accountName}</p></div><output className="font-mono text-4xl leading-10 font-semibold text-ink-strong" aria-label="OTP saat ini">{formatOtp(code)}</output><p className="text-sm text-muted-foreground">{seconds} dtk tersisa</p><Button className="w-full" type="button" onClick={() => void copyCode()}><Copy />{copied ? "OTP disalin" : "Salin OTP"}</Button><span className="sr-only" aria-live="polite">{copied ? "OTP disalin" : ""}</span></section>}
  </SurfaceCard></AppPage>;
}

function formatOtp(code: string) { if (!code) return "••• •••"; const middle = Math.ceil(code.length / 2); return `${code.slice(0, middle)} ${code.slice(middle)}`; }
