export function renderConfigurationPage(nonce, tailscaleOrigin, copies) {
  const setupData = JSON.stringify({ copies, tailscaleOrigin }).replace(/</gu, "\\u003c");
  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${copies.id.title}</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: light dark;
      font: 16px/1.5 system-ui, sans-serif;
      --hint-color: #595959;
      --error-color: #b42318;
    }
    @media (prefers-color-scheme: dark) {
      :root { --hint-color: #bdbdbd; --error-color: #ff8a80; }
    }
    body { max-width: 48rem; margin: 2rem auto; padding: 0 1rem; }
    body { background: Canvas; color: CanvasText; }
    form, fieldset { display: grid; gap: 1rem; }
    fieldset { border: 1px solid #8888; border-radius: .75rem; padding: 1rem; }
    label { display: grid; gap: .3rem; font-weight: 600; }
    input, select, button { min-height: 2.75rem; padding: .5rem; font: inherit; }
    input[type="checkbox"] { min-height: auto; }
    .check { display: flex; align-items: center; gap: .5rem; }
    .hint, #privacy { color: var(--hint-color); }
    #form-status { min-height: 1.5rem; }
    .field-error { color: var(--error-color); font-size: .9rem; }
    input[aria-invalid="true"] { outline: 2px solid var(--error-color); }
    .actions { display: flex; gap: .75rem; flex-wrap: wrap; }
    [hidden] { display: none !important; }
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
