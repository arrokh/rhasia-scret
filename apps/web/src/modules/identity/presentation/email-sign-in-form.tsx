"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { LoaderCircle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { captureAnalyticsEvent } from "@/shared/infrastructure/browser-analytics";
import { clearBrowserLocationFragment } from "@/shared/infrastructure/browser-location-fragment";
import { ANALYTICS_EVENTS } from "@/shared/infrastructure/browser-analytics-config";
import { browserPasswordlessClient, pollPwaAuthenticationHandoff } from "../infrastructure/browser-passwordless-client";
import {
  announcePwaAuthenticationCompletion,
  clearPwaAuthenticationHandoff,
  clearPwaAuthenticationProvisionalHandoff,
  createPwaAuthenticationHandoff,
  isPwaDisplayMode,
  readPwaAuthenticationHandoff,
  readPwaAuthenticationHandoffExpiresAt,
  readProvisionalPwaAuthenticationHandoff,
  storePwaAuthenticationHandoff,
  storeProvisionalPwaAuthenticationHandoff,
  subscribeToPwaAuthenticationCompletion,
  subscribeToPwaAuthenticationVerifierRequests,
  type PendingPwaAuthenticationHandoff,
} from "../infrastructure/pwa-authentication";
import { announceAuthenticationCompletion } from "./auth-completion-channel";
import { CloudflareTurnstileWidget } from "./cloudflare-turnstile-widget";
import { requestEmailSignInLink } from "./request-email-sign-in-link";
import {
  AUTH_COMPLETION_PATH,
  AUTH_RETURN_PATH_COOKIE,
  AUTH_RETURN_PATH_COOKIE_MAX_AGE_SECONDS,
  DEFAULT_AUTH_RETURN_PATH,
  INVITATION_AUTH_RETURN_PATH,
  resolveAuthReturnPath,
  type AuthReturnPath,
} from "../application/auth-return-path";

type ActivePwaAuthenticationHandoff = Readonly<{
  handoff: PendingPwaAuthenticationHandoff;
  expiresAt: number;
}>;

export function EmailSignInForm({
  nextPath = DEFAULT_AUTH_RETURN_PATH,
  turnstileSiteKey,
  navigate,
}: Readonly<{ nextPath?: string; turnstileSiteKey?: string; navigate?: (path: string) => void }>) {
  const t = useTranslations("Identity.signIn");
  const activeTurnstileSiteKey = turnstileSiteKey?.trim() || undefined;
  const returnPath = resolveAuthReturnPath(nextPath);
  const passwordlessReturnPath =
    returnPath === INVITATION_AUTH_RETURN_PATH ? INVITATION_AUTH_RETURN_PATH : DEFAULT_AUTH_RETURN_PATH;
  const goTo = useCallback(
    (path: string) => {
      if (navigate) {
        navigate(path);
        return;
      }
      window.location.replace(path);
    },
    [navigate],
  );
  const pwaMode = isPwaDisplayMode();
  const [status, setStatus] = useState<
    | "idle"
    | "sending"
    | "sent"
    | "authenticating"
    | "error"
    | "handoff_error"
    | "rate_limited"
    | "turnstile_required"
    | "turnstile_error"
  >("idle");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const [provisionalPwaHandoffState, setProvisionalPwaHandoffState] = useState<ActivePwaAuthenticationHandoff | null>(
    () => {
      if (!pwaMode) return null;
      const provisional = readProvisionalPwaAuthenticationHandoff();
      return provisional ? { handoff: provisional.handoff, expiresAt: provisional.expiresAt } : null;
    },
  );
  const [pendingPwaHandoffState, setPendingPwaHandoffState] = useState<ActivePwaAuthenticationHandoff | null>(() => {
    if (!pwaMode) return null;
    const handoff = readPwaAuthenticationHandoff();
    if (!handoff) return null;
    return {
      handoff,
      expiresAt: readPwaAuthenticationHandoffExpiresAt(handoff.handoffId) ?? Date.now() + PWA_HANDOFF_TIMEOUT_MS,
    };
  });
  const pendingPwaHandoffRef = useRef(pendingPwaHandoffState);
  const provisionalPwaHandoffRef = useRef(provisionalPwaHandoffState);
  const formMountedRef = useRef(false);
  const authenticationCompletedRef = useRef(false);
  useEffect(() => {
    formMountedRef.current = true;
    return () => {
      formMountedRef.current = false;
    };
  }, []);
  const setPendingPwaHandoff = useCallback((pending: ActivePwaAuthenticationHandoff | null) => {
    pendingPwaHandoffRef.current = pending;
    setPendingPwaHandoffState(pending);
  }, []);
  const setProvisionalPwaHandoff = useCallback((provisional: ActivePwaAuthenticationHandoff | null) => {
    provisionalPwaHandoffRef.current = provisional;
    setProvisionalPwaHandoffState(provisional);
  }, []);
  const completePwaAuthentication = useCallback(
    (handoffId: string, acceptedReturnPathValue: unknown) => {
      if (authenticationCompletedRef.current) return;
      authenticationCompletedRef.current = true;
      clearPwaAuthenticationHandoff();
      const acceptedReturnPath = resolveAuthReturnPath(acceptedReturnPathValue);
      try {
        announcePwaAuthenticationCompletion(handoffId, acceptedReturnPath);
      } catch {
        // The server accepted authentication; completion announcements are best-effort.
      }
      try {
        announceAuthenticationCompletion();
      } catch {
        // A failed session-change announcement must not block successful sign-in navigation.
      }
      if (!formMountedRef.current) {
        pendingPwaHandoffRef.current = null;
        provisionalPwaHandoffRef.current = null;
        return;
      }
      setPendingPwaHandoff(null);
      setProvisionalPwaHandoff(null);
      setStatus("authenticating");
      navigateAfterPwaAuthentication(acceptedReturnPath, returnPath, goTo);
    },
    [goTo, returnPath, setPendingPwaHandoff, setProvisionalPwaHandoff],
  );
  useEffect(() => {
    if (!pwaMode || !pendingPwaHandoffState) return;
    if (readPwaAuthenticationHandoffExpiresAt(pendingPwaHandoffState.handoff.handoffId) !== null) return;
    storePwaAuthenticationHandoff(pendingPwaHandoffState.handoff, pendingPwaHandoffState.expiresAt);
  }, [pendingPwaHandoffState, pwaMode]);

  useEffect(() => {
    if (!pwaMode || !provisionalPwaHandoffState) return;
    const { handoff, expiresAt } = provisionalPwaHandoffState;
    let timer: number | undefined;
    const expireHandoff = () => {
      if (provisionalPwaHandoffRef.current?.handoff.handoffId !== handoff.handoffId) return;
      clearPwaAuthenticationProvisionalHandoff(handoff.handoffId);
      if (formMountedRef.current) setProvisionalPwaHandoff(null);
      else provisionalPwaHandoffRef.current = null;
    };
    const scheduleExpiry = () => {
      const remainingMilliseconds = expiresAt - Date.now();
      if (remainingMilliseconds <= 0) {
        expireHandoff();
        return;
      }
      timer = window.setTimeout(scheduleExpiry, Math.min(remainingMilliseconds, MAX_TIMEOUT_DELAY_MS));
    };
    scheduleExpiry();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [pwaMode, provisionalPwaHandoffState, setProvisionalPwaHandoff]);

  useEffect(() => {
    if (!pwaMode) return;
    return subscribeToPwaAuthenticationVerifierRequests((handoffId) => {
      const pending = pendingPwaHandoffRef.current;
      if (pending?.handoff.handoffId === handoffId) {
        if (Date.now() >= pending.expiresAt) {
          clearPwaAuthenticationHandoff(handoffId);
          if (formMountedRef.current) setPendingPwaHandoff(null);
          else pendingPwaHandoffRef.current = null;
          return null;
        }
        return pending.handoff.verifier;
      }
      const provisional = provisionalPwaHandoffRef.current;
      if (provisional?.handoff.handoffId !== handoffId) return null;
      if (Date.now() >= provisional.expiresAt) {
        clearPwaAuthenticationProvisionalHandoff(handoffId);
        if (formMountedRef.current) setProvisionalPwaHandoff(null);
        else provisionalPwaHandoffRef.current = null;
        return null;
      }
      return provisional.handoff.verifier;
    });
  }, [pwaMode, setPendingPwaHandoff, setProvisionalPwaHandoff]);

  useEffect(() => {
    if (!pwaMode) return;
    return subscribeToPwaAuthenticationCompletion((handoffId, acceptedReturnPath) => {
      const pending = pendingPwaHandoffRef.current?.handoff;
      const provisional = provisionalPwaHandoffRef.current?.handoff;
      if (
        authenticationCompletedRef.current ||
        (pending?.handoffId !== handoffId && provisional?.handoffId !== handoffId)
      )
        return;
      authenticationCompletedRef.current = true;
      clearPwaAuthenticationHandoff();
      if (!formMountedRef.current) {
        pendingPwaHandoffRef.current = null;
        provisionalPwaHandoffRef.current = null;
        return;
      }
      setPendingPwaHandoff(null);
      setProvisionalPwaHandoff(null);
      setStatus("authenticating");
      navigateAfterPwaAuthentication(acceptedReturnPath, returnPath, goTo);
    });
  }, [goTo, pwaMode, returnPath, setPendingPwaHandoff, setProvisionalPwaHandoff]);

  useEffect(() => {
    if (!pwaMode || !pendingPwaHandoffState) return;
    const pending = pendingPwaHandoffState.handoff;
    const expiresAt = pendingPwaHandoffState.expiresAt;
    let active = true;
    let timer: number | undefined;
    let polling = false;
    let pollDelayMilliseconds = PWA_POLL_INITIAL_DELAY_MS;

    const expire = () => {
      clearPwaAuthenticationHandoff(pending.handoffId);
      if (pendingPwaHandoffRef.current?.handoff.handoffId === pending.handoffId) setPendingPwaHandoff(null);
      const provisional = provisionalPwaHandoffRef.current;
      if (provisional?.handoff.handoffId === pending.handoffId) setProvisionalPwaHandoff(null);
      if (provisional?.handoff.handoffId === undefined || provisional.handoff.handoffId === pending.handoffId)
        setStatus("handoff_error");
    };
    const schedulePoll = () => {
      if (!active || document.visibilityState === "hidden") return;
      const delay = pollDelayMilliseconds;
      pollDelayMilliseconds = Math.min(pollDelayMilliseconds * 2, PWA_POLL_MAX_DELAY_MS);
      timer = window.setTimeout(() => {
        timer = undefined;
        void poll();
      }, delay);
    };
    const poll = async () => {
      if (!active || polling || authenticationCompletedRef.current) return;
      if (document.visibilityState === "hidden") {
        if (timer !== undefined) window.clearTimeout(timer);
        timer = undefined;
        return;
      }
      if (timer !== undefined) window.clearTimeout(timer);
      if (Date.now() >= expiresAt) {
        expire();
        return;
      }
      polling = true;
      try {
        const result = await pollPwaAuthenticationHandoff(pending);
        if ("accepted" in result) {
          completePwaAuthentication(pending.handoffId, result.returnPath);
          return;
        }
        if (!active || authenticationCompletedRef.current) return;
        if (Date.now() >= expiresAt) {
          expire();
          return;
        }
        schedulePoll();
      } catch {
        if (!active || authenticationCompletedRef.current) return;
        if (Date.now() >= expiresAt) {
          expire();
          return;
        }
        schedulePoll();
      } finally {
        polling = false;
      }
    };
    const resume = () => {
      if (document.visibilityState === "hidden") {
        if (timer !== undefined) window.clearTimeout(timer);
        timer = undefined;
        return;
      }
      pollDelayMilliseconds = PWA_POLL_INITIAL_DELAY_MS;
      void poll();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);

    void poll();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
    };
  }, [completePwaAuthentication, pendingPwaHandoffState, pwaMode, setPendingPwaHandoff, setProvisionalPwaHandoff]);

  useEffect(() => {
    if (!pwaMode || !provisionalPwaHandoffState) return;
    const provisional = provisionalPwaHandoffState.handoff;
    const expiresAt = provisionalPwaHandoffState.expiresAt;
    if (pendingPwaHandoffState?.handoff.handoffId === provisional.handoffId) return;
    let active = true;
    let timer: number | undefined;
    let polling = false;
    let pollDelayMilliseconds = PWA_POLL_INITIAL_DELAY_MS;

    const expire = () => {
      clearPwaAuthenticationProvisionalHandoff(provisional.handoffId);
      if (provisionalPwaHandoffRef.current?.handoff.handoffId !== provisional.handoffId) return;
      setProvisionalPwaHandoff(null);
    };
    const schedulePoll = () => {
      if (!active || document.visibilityState === "hidden") return;
      const delay = pollDelayMilliseconds;
      pollDelayMilliseconds = Math.min(pollDelayMilliseconds * 2, PWA_POLL_MAX_DELAY_MS);
      timer = window.setTimeout(() => {
        timer = undefined;
        void poll();
      }, delay);
    };
    const poll = async () => {
      if (!active || polling || authenticationCompletedRef.current) return;
      if (document.visibilityState === "hidden") {
        if (timer !== undefined) window.clearTimeout(timer);
        timer = undefined;
        return;
      }
      if (timer !== undefined) window.clearTimeout(timer);
      if (Date.now() >= expiresAt) {
        expire();
        return;
      }
      polling = true;
      try {
        const result = await pollPwaAuthenticationHandoff(provisional);
        if ("accepted" in result) {
          completePwaAuthentication(provisional.handoffId, result.returnPath);
          return;
        }
        if (!active || authenticationCompletedRef.current) return;
        if (Date.now() >= expiresAt) {
          expire();
          return;
        }
        schedulePoll();
      } catch {
        if (!active || authenticationCompletedRef.current) return;
        if (Date.now() >= expiresAt) {
          expire();
          return;
        }
        schedulePoll();
      } finally {
        polling = false;
      }
    };
    const resume = () => {
      if (document.visibilityState === "hidden") {
        if (timer !== undefined) window.clearTimeout(timer);
        timer = undefined;
        return;
      }
      pollDelayMilliseconds = PWA_POLL_INITIAL_DELAY_MS;
      void poll();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);

    void poll();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
    };
  }, [
    completePwaAuthentication,
    pendingPwaHandoffState?.handoff.handoffId,
    provisionalPwaHandoffState,
    pwaMode,
    setProvisionalPwaHandoff,
  ]);

  const form = useForm({
    defaultValues: { email: "" },
    onSubmit: async ({ value }) => {
      if (retrySeconds > 0 || authenticationCompletedRef.current) return;
      if (activeTurnstileSiteKey && !turnstileToken) {
        setStatus("turnstile_required");
        return;
      }
      setStatus("sending");
      if (returnPath === INVITATION_AUTH_RETURN_PATH && !clearBrowserLocationFragment()) {
        setStatus("error");
        return;
      }
      rememberAuthReturnPath(returnPath);
      let result: Awaited<ReturnType<typeof requestEmailSignInLink>>;
      if (pwaMode) {
        const requestStartedAt = Date.now();
        const handoff = createPwaAuthenticationHandoff();
        const provisionalHandoff = { handoff, expiresAt: requestStartedAt + PWA_HANDOFF_TIMEOUT_MS };
        setProvisionalPwaHandoff(provisionalHandoff);
        storeProvisionalPwaAuthenticationHandoff(handoff, provisionalHandoff.expiresAt);
        result = await requestEmailSignInLink(browserPasswordlessClient, value.email, passwordlessReturnPath, {
          client: "pwa",
          handoffId: handoff.handoffId,
          handoffVerifier: handoff.verifier,
          ...(turnstileToken ? { turnstileToken } : {}),
        });
        if (result.status === "sent" && !authenticationCompletedRef.current) {
          const activeHandoff = { handoff, expiresAt: requestStartedAt + result.challengeExpiresInSeconds * 1_000 };
          storePwaAuthenticationHandoff(handoff, activeHandoff.expiresAt);
          if (provisionalPwaHandoffRef.current?.handoff.handoffId === handoff.handoffId) {
            if (formMountedRef.current) setProvisionalPwaHandoff(null);
            else provisionalPwaHandoffRef.current = null;
          }
          if (formMountedRef.current) setPendingPwaHandoff(activeHandoff);
        } else if (result.status === "rate_limited" || (result.status === "error" && result.definitivelyRejected)) {
          clearPwaAuthenticationProvisionalHandoff(handoff.handoffId);
          if (provisionalPwaHandoffRef.current?.handoff.handoffId === handoff.handoffId) {
            if (formMountedRef.current) setProvisionalPwaHandoff(null);
            else provisionalPwaHandoffRef.current = null;
          }
        }
      } else {
        setPendingPwaHandoff(null);
        result = turnstileToken
          ? await requestEmailSignInLink(browserPasswordlessClient, value.email, passwordlessReturnPath, {
              turnstileToken,
            })
          : await requestEmailSignInLink(browserPasswordlessClient, value.email, passwordlessReturnPath);
      }
      if (!formMountedRef.current) return;
      if (authenticationCompletedRef.current) {
        setStatus("authenticating");
        return;
      }
      setTurnstileToken(null);
      setTurnstileResetKey((key) => key + 1);
      if (result.status === "rate_limited") setRetrySeconds(60);
      if (result.status === "sent") {
        captureAnalyticsEvent(ANALYTICS_EVENTS.authenticationSignInLinkRequested, { method: "email" });
      } else {
        captureAnalyticsEvent(ANALYTICS_EVENTS.authenticationSignInLinkRequestFailed, {
          method: "email",
          failure_code: result.status === "rate_limited" ? "rate_limited" : "provider_error",
        });
      }
      setStatus(result.status);
    },
  });

  useEffect(() => {
    if (retrySeconds === 0) return;
    const timer = window.setTimeout(() => setRetrySeconds((seconds) => seconds - 1), 1_000);
    return () => window.clearTimeout(timer);
  }, [retrySeconds]);

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <div className="grid gap-1">
        <h2 className="text-base font-bold text-ink-strong">{t("title")}</h2>
        <p className="text-sm leading-5 text-muted-foreground">{t("description")}</p>
      </div>
      <form.Field
        name="email"
        validators={{
          onBlur: ({ value }) => validateEmail(value, t("emailRequired"), t("emailInvalid")),
          onSubmit: ({ value }) => validateEmail(value, t("emailRequired"), t("emailInvalid")),
        }}
      >
        {(field) => (
          <div className="grid gap-2">
            <Label htmlFor="email" className="sr-only">
              {t("emailLabel")}
            </Label>
            <div className="relative">
              <Mail
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="email"
                name={field.name}
                className="pl-10"
                type="email"
                autoComplete="email"
                placeholder={t("emailPlaceholder")}
                required
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={field.state.meta.errors.length > 0}
                aria-describedby={field.state.meta.errors.length ? "email-error" : "email-description"}
              />
            </div>
            <FormFieldError id="email-error" errors={field.state.meta.errors} />
            <p id="email-description" className="text-xs leading-5 text-muted-foreground">
              {t(returnPath === INVITATION_AUTH_RETURN_PATH ? "invitationEmailDescription" : "emailDescription")}
            </p>
          </div>
        )}
      </form.Field>
      {activeTurnstileSiteKey && (
        <CloudflareTurnstileWidget
          key={turnstileResetKey}
          siteKey={activeTurnstileSiteKey}
          action="magic_link_request"
          label={t("securityCheck")}
          onTokenChange={(token) => {
            setTurnstileToken(token);
            if (token) setStatus((current) => (current === "turnstile_required" ? "idle" : current));
          }}
          onError={() => {
            setTurnstileToken(null);
            setStatus("turnstile_error");
          }}
        />
      )}
      <form.Subscribe<boolean> selector={(formState) => formState.isSubmitting}>
        {(isSubmitting) => (
          <Button
            type={status === "sent" ? "button" : "submit"}
            variant={status === "sent" ? "ghost" : "default"}
            className="w-full"
            disabled={
              isSubmitting ||
              retrySeconds > 0 ||
              status === "authenticating" ||
              Boolean(activeTurnstileSiteKey && !turnstileToken)
            }
            aria-busy={isSubmitting}
            onClick={status === "sent" ? () => window.location.reload() : undefined}
          >
            {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            {isSubmitting
              ? t("sending")
              : status === "sent"
                ? t("retryPage")
                : retrySeconds > 0
                  ? t("retryIn", { seconds: retrySeconds })
                  : t("sendLink")}
          </Button>
        )}
      </form.Subscribe>
      {status === "sent" && (
        <StatusBanner tone="success">
          {t(pwaMode ? "sentPwa" : returnPath === INVITATION_AUTH_RETURN_PATH ? "sentInvitation" : "sent")}
        </StatusBanner>
      )}
      {status === "authenticating" && <StatusBanner tone="info">{t("authenticating")}</StatusBanner>}
      {status === "rate_limited" && <StatusBanner tone="warning">{t("rateLimited")}</StatusBanner>}
      {status === "turnstile_required" && <StatusBanner tone="warning">{t("turnstileRequired")}</StatusBanner>}
      {status === "turnstile_error" && (
        <StatusBanner tone="danger" role="alert">
          {t("turnstileError")}
        </StatusBanner>
      )}
      {status === "error" && (
        <StatusBanner tone="danger" role="alert">
          {t("error")}
        </StatusBanner>
      )}
      {status === "handoff_error" && (
        <StatusBanner tone="danger" role="alert">
          {t("handoffError")}
        </StatusBanner>
      )}
    </form>
  );
}

const PWA_HANDOFF_TIMEOUT_MS = 3_600_000;
const PWA_POLL_INITIAL_DELAY_MS = 1_000;
const PWA_POLL_MAX_DELAY_MS = 10_000;
const MAX_TIMEOUT_DELAY_MS = 2_147_483_647;

function validateEmail(value: string, requiredMessage: string, invalidMessage: string): string | undefined {
  const normalized = value.trim();
  if (!normalized) return requiredMessage;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? undefined : invalidMessage;
}

function navigateAfterPwaAuthentication(
  acceptedReturnPath: unknown,
  requestedReturnPath: AuthReturnPath,
  goTo: (path: string) => void,
): void {
  if (requestedReturnPath === INVITATION_AUTH_RETURN_PATH) return;
  const returnPath = resolveAuthReturnPath(acceptedReturnPath);
  goTo(returnPath === INVITATION_AUTH_RETURN_PATH ? AUTH_COMPLETION_PATH : returnPath);
}

function rememberAuthReturnPath(path: string): void {
  const attributes = [
    `${AUTH_RETURN_PATH_COOKIE}=${encodeURIComponent(path)}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${AUTH_RETURN_PATH_COOKIE_MAX_AGE_SECONDS}`,
  ];
  if (window.location.protocol === "https:") attributes.push("Secure");
  document.cookie = attributes.join("; ");
}
