export function renderConfigurationPage(nonce, tailscaleOrigin, copies) {
  const setupData = JSON.stringify({ copies, tailscaleOrigin }).replace(/</gu, "\\u003c");
  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#f8f4ed">
  <title>${copies.id.title}</title>
  <style nonce="${nonce}">
    :root {
      /* Mirror the web app's light theme for this standalone local setup surface. */
      color-scheme: light;
      font: 16px/1.5 "Manrope", Arial, Helvetica, sans-serif;
      --background: #f8f4ed;
      --foreground: #273039;
      --card: #fffdf9;
      --primary: #e5a72e;
      --primary-hover: #d49722;
      --primary-foreground: #171d22;
      --muted: #f1eee9;
      --muted-foreground: #586169;
      --accent: #fff2d8;
      --border: #ded8d0;
      --input: #ded8d0;
      --ring: #c88717;
      --destructive: #a4433d;
      --success: #3d7452;
      --success-surface: #eaf3ec;
      --warning: #a5661b;
      --warning-surface: #fff2d8;
      --info-surface: #eaf0f4;
      --gold-soft: #f5d998;
      --taupe: #91867e;
      --ink-strong: #171d22;
      --radius-control: 0.75rem;
      --radius-card: 1rem;
      --shadow-card: 0 1px 2px rgb(23 29 34 / 4%), 0 8px 24px rgb(23 29 34 / 6%);
    }
    *, *::before, *::after { box-sizing: border-box; }
    html { min-height: 100%; background: var(--background); }
    body {
      min-height: 100vh;
      margin: 0;
      background: var(--background);
      color: var(--foreground);
      caret-color: var(--ring);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      scrollbar-color: var(--taupe) var(--muted);
      scrollbar-width: thin;
    }
    ::selection { background: var(--gold-soft); color: var(--ink-strong); }
    ::-webkit-scrollbar { width: 0.75rem; }
    ::-webkit-scrollbar-track { background: var(--muted); }
    ::-webkit-scrollbar-thumb {
      border: 3px solid var(--muted);
      border-radius: 999px;
      background: var(--taupe);
    }
    :where(button, input, select, summary):focus-visible {
      outline: 3px solid rgb(200 135 23 / 32%);
      outline-offset: 2px;
      border-color: var(--ring);
    }
    .setup-shell {
      width: 100%;
      max-width: 48rem;
      min-height: 100vh;
      margin-inline: auto;
      padding: 1.75rem 1rem calc(6rem + env(safe-area-inset-bottom));
    }
    .setup-heading {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .setup-heading-copy { min-width: 0; flex: 1; }
    .setup-brand {
      color: var(--ink-strong);
      font-size: 1rem;
      font-weight: 700;
      letter-spacing: -0.025em;
      white-space: nowrap;
    }
    .setup-brand-accent { color: var(--primary); }
    label.language-control {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      color: var(--muted-foreground);
      font-size: 0.8125rem;
      font-weight: 700;
      flex-shrink: 0;
    }
    .language-control select { width: auto; min-width: 9rem; }
    .setup-heading h1 {
      margin: 0;
      color: var(--ink-strong);
      font-size: 1.25rem;
      font-weight: 700;
      letter-spacing: -0.025em;
      line-height: 1.75rem;
      text-wrap: balance;
    }
    .setup-heading p {
      max-width: 65ch;
      margin: 0.375rem 0 0;
      color: var(--muted-foreground);
      font-size: 0.875rem;
      line-height: 1.75rem;
    }
    #setup-form, fieldset, #passkeyFields, details { display: grid; gap: 1rem; }
    #setup-form {
      gap: 1.5rem;
      padding: 1.25rem;
      border: 1px solid var(--border);
      border-radius: var(--radius-card);
      background: var(--card);
      box-shadow: var(--shadow-card);
    }
    label:not(.check) { display: grid; gap: 0.5rem; font-size: 0.875rem; font-weight: 700; }
    input, select, button {
      min-width: 0;
      min-height: 3rem;
      padding: 0.625rem 0.75rem;
      border: 1px solid var(--input);
      border-radius: var(--radius-control);
      background: var(--card);
      color: var(--foreground);
      font: inherit;
      font-size: 0.875rem;
    }
    input, select { width: 100%; }
    input::placeholder { color: var(--muted-foreground); opacity: 1; }
    input:disabled, select:disabled, button:disabled {
      cursor: not-allowed;
      background: var(--muted);
      color: var(--muted-foreground);
      opacity: 1;
    }
    input[type="checkbox"] {
      width: 1.125rem;
      min-width: 1.125rem;
      min-height: 1.125rem;
      height: 1.125rem;
      margin: 0;
      padding: 0;
      accent-color: var(--ring);
    }
    button { cursor: pointer; font-weight: 700; transition: background-color 150ms, border-color 150ms, transform 150ms; }
    button:hover:not(:disabled) { border-color: var(--ring); }
    button:active:not(:disabled) { transform: translateY(1px); }
    .button-primary {
      border-color: transparent;
      background: var(--primary);
      color: var(--primary-foreground);
    }
    .button-primary:hover:not(:disabled) { border-color: transparent; background: var(--primary-hover); }
    .button-outline { background: transparent; }
    .button-outline:hover:not(:disabled) { background: var(--muted); }
    .use-origin { width: 100%; text-align: left; }
    fieldset {
      min-width: 0;
      margin: 0;
      padding: 1rem;
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      background: var(--muted);
    }
    legend { padding: 0 0.25rem; color: var(--ink-strong); font-size: 0.875rem; font-weight: 700; }
    fieldset[hidden] { display: none !important; }
    .check {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-height: 3rem;
      padding: 0.625rem 0.75rem;
      border-radius: var(--radius-control);
      background: var(--card);
      font-size: 0.875rem;
      font-weight: 700;
      cursor: pointer;
    }
    .hint { margin: 0; color: var(--muted-foreground); font-size: 0.8125rem; line-height: 1.5; }
    #authBackend-description {
      padding: 0.875rem 1rem;
      border-radius: var(--radius-control);
      background: var(--warning-surface);
      color: var(--foreground);
    }
    #authBackend-description[data-auth-mode="passwordless"] { background: var(--info-surface); }
    .field-error { color: var(--destructive); font-size: 0.8125rem; font-weight: 600; }
    input[aria-invalid="true"] { border-color: var(--destructive); outline: 3px solid rgb(164 67 61 / 18%); }
    details {
      gap: 1rem;
      padding: 0.75rem 0;
      border-top: 1px solid var(--border);
    }
    summary {
      display: flex;
      align-items: center;
      min-height: 3rem;
      color: var(--foreground);
      font-size: 0.875rem;
      font-weight: 700;
      cursor: pointer;
    }
    details[open] summary { margin-bottom: 0.25rem; }
    #privacy {
      padding: 0.875rem 1rem;
      border-radius: var(--radius-control);
      background: var(--muted);
    }
    #form-status { margin: 0; color: var(--muted-foreground); font-size: 0.875rem; }
    #form-status:not(:empty) {
      padding: 0.875rem 1rem;
      border-radius: var(--radius-control);
      background: var(--info-surface);
      color: var(--foreground);
    }
    #form-status[data-state="saved"] { background: var(--success-surface); color: var(--success); }
    #form-status[data-state="cancelled"] { background: var(--muted); }
    #form-status[data-state="invalid"],
    #form-status[data-state="conflict"],
    #form-status[data-state="unavailable"],
    #form-status[data-state="unsupported"] {
      background: #f9e9e6;
      color: var(--destructive);
    }
    .setup-success-dialog {
      width: min(calc(100% - 2rem), 34rem);
      padding: 1.5rem;
      border: 1px solid var(--border);
      border-radius: var(--radius-card);
      background: var(--card);
      color: var(--foreground);
      box-shadow: var(--shadow-card);
    }
    .setup-success-dialog::backdrop {
      background: rgb(23 29 34 / 48%);
      backdrop-filter: blur(2px);
    }
    .setup-success-heading {
      display: flex;
      align-items: center;
      gap: 0.875rem;
      margin-bottom: 1rem;
    }
    .setup-success-heading h2 {
      margin: 0;
      color: var(--ink-strong);
      font-size: 1.125rem;
      line-height: 1.5;
    }
    .setup-success-mark {
      display: grid;
      width: 2.5rem;
      height: 2.5rem;
      flex: 0 0 auto;
      place-items: center;
      border-radius: 999px;
      background: var(--success-surface);
      color: var(--success);
      font-size: 1.25rem;
      font-weight: 700;
    }
    .setup-success-dialog p {
      margin: 0 0 0.875rem;
      font-size: 0.9375rem;
    }
    .setup-success-dialog .setup-success-close-note,
    .setup-success-dialog .setup-success-backup {
      padding: 0.75rem 0.875rem;
      border-radius: var(--radius-control);
      background: var(--muted);
      color: var(--muted-foreground);
      font-size: 0.8125rem;
    }
    .setup-success-dialog .setup-success-backup {
      overflow-wrap: anywhere;
    }
    .setup-success-dialog button {
      width: 100%;
      margin-top: 0.25rem;
    }
    .actions { display: flex; justify-content: flex-end; gap: 0.75rem; }
    .actions button { min-width: 10rem; }
    .setup-footer {
      position: fixed;
      z-index: 40;
      inset: auto 0 0;
      border-top: 1px solid rgb(222 216 208 / 80%);
      background: rgb(248 244 237 / 95%);
      backdrop-filter: blur(8px);
    }
    .setup-footer-content {
      display: flex;
      align-items: center;
      width: min(100%, 48rem);
      min-height: 3.5rem;
      margin-inline: auto;
      padding: 0.5rem 1rem calc(0.5rem + env(safe-area-inset-bottom));
    }
    [hidden] { display: none !important; }
    @media (min-width: 640px) {
      .setup-shell { padding: 3rem 1.5rem calc(6rem + env(safe-area-inset-bottom)); }
      #setup-form { padding: 1.5rem; }
      .setup-heading h1 { font-size: 1.5rem; line-height: 2rem; }
      .setup-heading p { margin-top: 0.5rem; }
      .setup-footer-content { padding-right: 1.5rem; padding-left: 1.5rem; }
    }
    @media (max-width: 639px) {
      .setup-heading { flex-direction: column; }
      .language-control { align-self: flex-end; }
    }
    @media (max-width: 480px) {
      .actions { display: grid; grid-template-columns: 1fr; }
      .actions button { width: 100%; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0.01ms !important; }
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <noscript><p>${copies.id.noScript} / ${copies.en.noScript}</p></noscript>
  <script nonce="${nonce}">window.rhasiaSetup = ${setupData};</script>
  <script nonce="${nonce}" src="/wizard.js" defer></script>
</body>
</html>`;
}
