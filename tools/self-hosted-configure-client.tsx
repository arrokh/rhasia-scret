"use client";

import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useForm } from "@tanstack/react-form";

type Locale = "id" | "en";
type SetupValues = {
  authBackend: "none" | "passwordless";
  tailscaleMode: "none" | "serve" | "funnel";
  webOrigin: string;
  turnstileSiteKey: string;
  turnstileSecretKey: string;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPassword: string;
  authEmailFrom: string;
  authEmailFromName: string;
  passkeyEnabled: boolean;
  passkeyRpId: string;
  passkeyOrigin: string;
  appBindAddress: string;
  appPort: string;
};
type SetupStringField = Exclude<keyof SetupValues, "authBackend" | "passkeyEnabled" | "tailscaleMode">;
type SetupCopy = {
  title: string;
  intro: string;
  language: string;
  backend: string;
  origin: string;
  originHelp: string;
  providerTitle: string;
  turnstileSite: string;
  turnstileSecret: string;
  turnstileHelp: string;
  turnstilePair: string;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPassword: string;
  fromAddress: string;
  fromName: string;
  useTailscaleOrigin: string;
  tailscaleMode: string;
  tailscaleModeNone: string;
  tailscaleModeServe: string;
  tailscaleModeFunnel: string;
  tailscaleModeHelp: string;
  tailscaleFunnelHelp: string;
  passkeyEnabled: string;
  passkeyRp: string;
  passkeyOrigin: string;
  advanced: string;
  bindAddress: string;
  bindHelp: string;
  appPort: string;
  save: string;
  cancel: string;
  privacy: string;
  saving: string;
  saved: string;
  savedWithBackup: string;
  savedDialogTitle: string;
  savedDialogNextStep: string;
  savedDialogCloseTab: string;
  savedDialogAction: string;
  cancelled: string;
  invalid: string;
  invalidField: string;
  conflict: string;
  unavailable: string;
  required: string;
  unsupported: string;
  noneOption: string;
  noneDescription: string;
  passwordlessDescription: string;
  passwordlessOption: string;
};

declare global {
  interface Window {
    rhasiaSetup: {
      copies: Record<Locale, SetupCopy>;
      tailscaleOrigin: string | null;
    };
  }
}

const defaultValues: SetupValues = {
  authBackend: "none",
  tailscaleMode: "none",
  webOrigin: "http://localhost:3000",
  turnstileSiteKey: "",
  turnstileSecretKey: "",
  smtpHost: "",
  smtpPort: "587",
  smtpUser: "",
  smtpPassword: "",
  authEmailFrom: "",
  authEmailFromName: "rhasia-scret",
  passkeyEnabled: false,
  passkeyRpId: "",
  passkeyOrigin: "",
  appBindAddress: "127.0.0.1",
  appPort: "3000",
};

const passwordlessFields = new Set<SetupStringField>([
  "smtpHost",
  "smtpPort",
  "smtpUser",
  "smtpPassword",
  "authEmailFrom",
  "authEmailFromName",
]);
const turnstileFields = ["turnstileSiteKey", "turnstileSecretKey"] as const;
const passkeyFields = ["passkeyRpId", "passkeyOrigin"] as const;

function SetupWizard() {
  const [locale, setLocale] = useState<Locale>("id");
  const [savedBackup, setSavedBackup] = useState<string | null>(null);
  const savedDialogRef = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<
    keyof Pick<SetupCopy, "saved" | "cancelled" | "invalid" | "conflict" | "unavailable" | "unsupported"> | null
  >(null);
  const copy = window.rhasiaSetup.copies[locale];
  const tailscaleOrigin = window.rhasiaSetup.tailscaleOrigin;
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = copy.title;
  }, [copy.title, locale]);
  useEffect(() => {
    const dialog = savedDialogRef.current;
    if (status === "saved" && dialog && !dialog.open) dialog.showModal();
    if (status !== "saved" && dialog?.open) dialog.close();
  }, [status]);
  const form = useForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      setStatus(null);
      setSavedBackup(null);
      const response = await submitConfiguration(value);
      if (response.kind === "saved") {
        form.reset();
        setSavedBackup(response.backupFile ?? null);
        setStatus("saved");
        return;
      }
      for (const issue of response.fields ?? []) {
        const separator = issue.indexOf(":");
        if (separator < 1) continue;
        const fieldName = issue.slice(0, separator);
        if (!isSetupField(fieldName)) continue;
        const rule = issue.slice(separator + 1);
        const error = rule === "required" ? "required" : rule === "pair" ? "pair" : "invalid";
        form.setFieldMeta(fieldName, (previous) => ({ ...previous, errors: [error] }));
      }
      setStatus(response.kind);
    },
  });

  function validateTextField(name: SetupStringField, value: string) {
    if (name === "webOrigin" && !value.trim()) return "required";
    if (form.getFieldValue("authBackend") !== "passwordless") return undefined;
    if (passwordlessFields.has(name) && !value.trim()) return "required";
    if (name === "turnstileSiteKey" || name === "turnstileSecretKey") {
      const siteKey = (name === "turnstileSiteKey" ? value : form.getFieldValue("turnstileSiteKey")).trim();
      const secretKey = (name === "turnstileSecretKey" ? value : form.getFieldValue("turnstileSecretKey")).trim();
      if (Boolean(siteKey) !== Boolean(secretKey)) return "pair";
    }
    if (form.getFieldValue("passkeyEnabled") && (name === "passkeyRpId" || name === "passkeyOrigin") && !value.trim()) {
      return "required";
    }
    return undefined;
  }

  function validators(name: SetupStringField) {
    const validate = ({ value }: { value: string }) => validateTextField(name, value);
    return { onChange: validate, onBlur: validate, onSubmit: validate };
  }

  function renderTextField({
    name,
    label,
    type = "text",
    maxLength,
    autoComplete = "off",
    inputMode,
    required = false,
    disabled = false,
  }: {
    name: SetupStringField;
    label: string;
    type?: "text" | "password";
    maxLength: number;
    autoComplete?: string;
    inputMode?: "numeric";
    required?: boolean;
    disabled?: boolean;
  }) {
    return (
      <form.Field key={name} name={name} validators={validators(name)}>
        {(field) => {
          const errors = field.state.meta.errors.filter(isFormError);
          const invalid = errors.length > 0;
          const errorMessage =
            errors[0] === "required" ? copy.required : errors[0] === "pair" ? copy.turnstilePair : copy.invalidField;
          return (
            <label htmlFor={name}>
              <span>{label}</span>
              <input
                id={name}
                name={field.name}
                type={type}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                autoComplete={autoComplete}
                maxLength={maxLength}
                inputMode={inputMode}
                spellCheck={false}
                disabled={disabled}
                aria-required={required}
                aria-invalid={invalid}
                aria-describedby={invalid ? `${name}-error` : undefined}
              />
              {invalid ? (
                <span id={`${name}-error`} className="field-error">
                  {errorMessage}
                </span>
              ) : null}
            </label>
          );
        }}
      </form.Field>
    );
  }

  async function submitConfiguration(value: SetupValues) {
    let response: Response;
    try {
      response = await fetch("/configure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(value),
      });
    } catch {
      return { kind: "unavailable" as const, fields: [] as string[], backupFile: undefined };
    }

    let result: { error?: string; fields?: string[]; backupFile?: string };
    try {
      result = (await response.json()) as { error?: string; fields?: string[]; backupFile?: string };
    } catch {
      return { kind: "unavailable" as const, fields: [] as string[], backupFile: undefined };
    }
    if (response.status === 201) {
      return { kind: "saved" as const, fields: [] as string[], backupFile: result.backupFile };
    }
    if (result.error === "env_exists")
      return { kind: "conflict" as const, fields: [] as string[], backupFile: undefined };
    if (result.fields?.some((field) => field.endsWith(":unsupported"))) {
      return { kind: "unsupported" as const, fields: result.fields, backupFile: undefined };
    }
    return { kind: "invalid" as const, fields: result.fields ?? [], backupFile: undefined };
  }

  async function cancel() {
    try {
      await fetch("/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: "{}",
      });
    } catch {
      // The local server also closes automatically when its session expires.
    }
    form.reset();
    setStatus("cancelled");
  }

  function useDetectedOrigin() {
    if (!tailscaleOrigin) return;
    form.setFieldValue("webOrigin", tailscaleOrigin);
    setStatus(null);
  }

  function selectTailscaleMode(tailscaleMode: SetupValues["tailscaleMode"]) {
    form.setFieldValue("tailscaleMode", tailscaleMode);
    if (tailscaleMode !== "none" && tailscaleOrigin) {
      form.setFieldValue("webOrigin", tailscaleOrigin);
      form.setFieldMeta("webOrigin", (previous) => ({ ...previous, errors: [] }));
      form.setFieldValue("appBindAddress", "127.0.0.1");
      form.setFieldMeta("appBindAddress", (previous) => ({ ...previous, errors: [] }));
    }
    setStatus(null);
  }

  function updatePasskeyDefaults(enabled: boolean) {
    form.setFieldValue("passkeyEnabled", enabled);
    if (!enabled) {
      for (const name of passkeyFields) {
        form.setFieldValue(name, "");
        form.setFieldMeta(name, (previous) => ({ ...previous, errors: [] }));
      }
      return;
    }
    for (const name of passkeyFields) {
      form.setFieldMeta(name, (previous) => ({ ...previous, errors: [] }));
    }
    try {
      const origin = new URL(form.getFieldValue("webOrigin"));
      form.setFieldValue("passkeyRpId", origin.hostname);
      form.setFieldValue("passkeyOrigin", origin.origin);
    } catch {
      return;
    }
  }

  const showStatus =
    status === "saved" && savedBackup
      ? copy.savedWithBackup.replace("{backup}", savedBackup)
      : status === "saved" || status === "cancelled"
        ? copy[status]
        : status === null
          ? ""
          : copy[status];

  return (
    <main className="setup-shell">
      <header className="setup-heading">
        <div className="setup-heading-copy">
          <h1>{copy.title}</h1>
          <p>{copy.intro}</p>
        </div>
        <label className="language-control" htmlFor="language">
          <span>{copy.language}</span>
          <select id="language" value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
            <option value="id">Bahasa Indonesia</option>
            <option value="en">English</option>
          </select>
        </label>
      </header>
      <form
        id="setup-form"
        autoComplete="off"
        noValidate
        aria-busy={form.state.isSubmitting}
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <form.Field name="authBackend">
          {(field) => (
            <label htmlFor="authBackend">
              <span>{copy.backend}</span>
              <select
                id="authBackend"
                aria-describedby="authBackend-description"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  const authBackend = event.target.value as SetupValues["authBackend"];
                  field.handleChange(authBackend);
                  if (authBackend === "none") {
                    form.setFieldValue("passkeyEnabled", false);
                    for (const name of [...turnstileFields, ...passwordlessFields, ...passkeyFields]) {
                      form.setFieldValue(name, "");
                      form.setFieldMeta(name, (previous) => ({ ...previous, errors: [] }));
                    }
                  }
                  setStatus(null);
                }}
              >
                <option value="none">{copy.noneOption}</option>
                <option value="passwordless">{copy.passwordlessOption}</option>
              </select>
            </label>
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.values.authBackend}>
          {(authBackend) => (
            <p id="authBackend-description" className="hint" data-auth-mode={authBackend}>
              {authBackend === "none" ? copy.noneDescription : copy.passwordlessDescription}
            </p>
          )}
        </form.Subscribe>
        {tailscaleOrigin ? (
          <form.Field name="tailscaleMode">
            {(field) => (
              <div>
                <label htmlFor="tailscaleMode">
                  <span>{copy.tailscaleMode}</span>
                  <select
                    id="tailscaleMode"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => selectTailscaleMode(event.target.value as SetupValues["tailscaleMode"])}
                  >
                    <option value="none">{copy.tailscaleModeNone}</option>
                    <option value="serve">{copy.tailscaleModeServe}</option>
                    <option value="funnel">{copy.tailscaleModeFunnel}</option>
                  </select>
                </label>
                <p className="hint">
                  {field.state.value === "funnel" ? copy.tailscaleFunnelHelp : copy.tailscaleModeHelp}
                </p>
              </div>
            )}
          </form.Field>
        ) : null}
        <form.Subscribe selector={(state) => state.values.tailscaleMode}>
          {(tailscaleMode) =>
            renderTextField({
              name: "webOrigin",
              label: copy.origin,
              maxLength: 512,
              required: true,
              disabled: tailscaleMode !== "none",
            })
          }
        </form.Subscribe>
        {tailscaleOrigin ? (
          <button
            type="button"
            id="useTailscaleOrigin"
            className="button-outline use-origin"
            onClick={useDetectedOrigin}
          >
            {copy.useTailscaleOrigin.replace("{origin}", tailscaleOrigin)}
          </button>
        ) : null}
        <p className="hint">{copy.originHelp}</p>
        <form.Subscribe selector={(state) => state.values.authBackend}>
          {(authBackend) => {
            const passwordless = authBackend === "passwordless";
            return (
              <fieldset id="passwordlessFields" disabled={!passwordless} hidden={!passwordless}>
                <legend>{copy.providerTitle}</legend>
                {renderTextField({
                  name: "turnstileSiteKey",
                  label: copy.turnstileSite,
                  maxLength: 1024,
                })}
                {renderTextField({
                  name: "turnstileSecretKey",
                  label: copy.turnstileSecret,
                  type: "password",
                  maxLength: 1024,
                })}
                <p className="hint">{copy.turnstileHelp}</p>
                {renderTextField({ name: "smtpHost", label: copy.smtpHost, maxLength: 255, required: passwordless })}
                {renderTextField({
                  name: "smtpPort",
                  label: copy.smtpPort,
                  maxLength: 5,
                  inputMode: "numeric",
                  required: passwordless,
                })}
                {renderTextField({ name: "smtpUser", label: copy.smtpUser, maxLength: 512, required: passwordless })}
                {renderTextField({
                  name: "smtpPassword",
                  label: copy.smtpPassword,
                  type: "password",
                  maxLength: 1024,
                  autoComplete: "new-password",
                  required: passwordless,
                })}
                {renderTextField({
                  name: "authEmailFrom",
                  label: copy.fromAddress,
                  maxLength: 255,
                  required: passwordless,
                })}
                {renderTextField({
                  name: "authEmailFromName",
                  label: copy.fromName,
                  maxLength: 255,
                  required: passwordless,
                })}
                <form.Field name="passkeyEnabled">
                  {(field) => (
                    <label className="check" htmlFor="passkeyEnabled">
                      <input
                        id="passkeyEnabled"
                        type="checkbox"
                        checked={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => updatePasskeyDefaults(event.target.checked)}
                      />
                      <span>{copy.passkeyEnabled}</span>
                    </label>
                  )}
                </form.Field>
                <form.Subscribe selector={(state) => state.values.passkeyEnabled}>
                  {(passkeyEnabled) =>
                    passkeyEnabled ? (
                      <div id="passkeyFields">
                        {renderTextField({
                          name: "passkeyRpId",
                          label: copy.passkeyRp,
                          maxLength: 253,
                          required: passwordless,
                        })}
                        {renderTextField({
                          name: "passkeyOrigin",
                          label: copy.passkeyOrigin,
                          maxLength: 512,
                          required: passwordless,
                        })}
                      </div>
                    ) : null
                  }
                </form.Subscribe>
              </fieldset>
            );
          }}
        </form.Subscribe>
        <details>
          <summary>{copy.advanced}</summary>
          <form.Subscribe selector={(state) => state.values.tailscaleMode}>
            {(tailscaleMode) =>
              renderTextField({
                name: "appBindAddress",
                label: copy.bindAddress,
                maxLength: 15,
                disabled: tailscaleMode !== "none",
              })
            }
          </form.Subscribe>
          <p className="hint">{copy.bindHelp}</p>
          {renderTextField({ name: "appPort", label: copy.appPort, maxLength: 5, inputMode: "numeric" })}
        </details>
        <p id="privacy" className="hint">
          {copy.privacy}
        </p>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <p
              id="form-status"
              data-state={isSubmitting ? "saving" : (status ?? undefined)}
              role="alert"
              aria-live="assertive"
            >
              {isSubmitting ? copy.saving : showStatus}
            </p>
          )}
        </form.Subscribe>
        <div className="actions">
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <>
                <button type="submit" className="button-primary" disabled={isSubmitting}>
                  {copy.save}
                </button>
                <button
                  type="button"
                  id="cancel"
                  className="button-outline"
                  disabled={isSubmitting}
                  onClick={() => void cancel()}
                >
                  {copy.cancel}
                </button>
              </>
            )}
          </form.Subscribe>
        </div>
      </form>
      <footer className="setup-footer">
        <div className="setup-footer-content">
          <div className="setup-brand" aria-label="rhasia-scret">
            <span>rhasia-</span>
            <span className="setup-brand-accent">scret</span>
          </div>
        </div>
      </footer>
      <dialog
        ref={savedDialogRef}
        className="setup-success-dialog"
        aria-labelledby="save-success-title"
        aria-describedby="save-success-next-step save-success-close-tab"
      >
        <div className="setup-success-heading">
          <span className="setup-success-mark" aria-hidden="true">
            ✓
          </span>
          <h2 id="save-success-title">{copy.savedDialogTitle}</h2>
        </div>
        <p id="save-success-next-step">{copy.savedDialogNextStep}</p>
        <p id="save-success-close-tab" className="setup-success-close-note">
          {copy.savedDialogCloseTab}
        </p>
        {savedBackup ? (
          <p className="setup-success-backup">{copy.savedWithBackup.replace("{backup}", savedBackup)}</p>
        ) : null}
        <button type="button" className="button-primary" onClick={() => savedDialogRef.current?.close()}>
          {copy.savedDialogAction}
        </button>
      </dialog>
    </main>
  );
}

function isSetupField(value: string): value is keyof SetupValues {
  return Object.hasOwn(defaultValues, value);
}

function isFormError(value: unknown): value is string {
  return value === "required" || value === "invalid" || value === "pair";
}

const target = document.querySelector("#root");
if (!target) throw new Error("The local setup form root is missing.");
createRoot(target).render(<SetupWizard />);
