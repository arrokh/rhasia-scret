import enMessages from "../../../messages/en.json";

const footerCopy = enMessages.Common;

// Keep these inline email tokens aligned with the web tokens in globals.css and the mobile design system.
// Email clients cannot load the app stylesheet, so the values intentionally stay local and explicit.
export const emailColors = {
  background: "#f8f4ed",
  surface: "#fffdf9",
  mutedSurface: "#f1eee9",
  border: "#ded8d0",
  subtleBorder: "#e5e3df",
  ink: "#273039",
  inkStrong: "#171d22",
  gold: "#e5a72e",
  goldStrong: "#c88717",
  mutedText: "#737b81",
} as const;

export const emailFontStack = "Manrope, Arial, Helvetica, sans-serif";

type EmailTemplateLayout = Readonly<{
  subject: string;
  content: string;
}>;

export function renderEmailTemplate({ subject, content }: EmailTemplateLayout): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<title>${escapeHtml(subject)}</title>`,
    "</head>",
    `<body style="margin:0;background-color:${emailColors.background};color:${emailColors.ink};font-family:${emailFontStack};-webkit-text-size-adjust:100%;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:${emailColors.background};">`,
    "  <tr>",
    '    <td align="center" style="padding:24px 16px 40px;">',
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border:1px solid ${emailColors.border};border-top:4px solid ${emailColors.gold};border-radius:16px;background-color:${emailColors.surface};box-shadow:0 1px 2px rgba(23,29,34,0.04),0 8px 24px rgba(23,29,34,0.06);">`,
    "  <tr>",
    `    <td align="center" style="padding:20px 32px 18px;border-bottom:1px solid ${emailColors.subtleBorder};">`,
    `      <div style="font-size:18px;line-height:22px;font-weight:700;letter-spacing:-0.02em;">${renderWordmark()}</div>`,
    "    </td>",
    "  </tr>",
    "  <tr>",
    '    <td style="padding:32px;">',
    content,
    "    </td>",
    "  </tr>",
    "  <tr>",
    `    <td align="center" style="padding:16px 32px 20px;border-top:1px solid ${emailColors.subtleBorder};color:${emailColors.mutedText};">`,
    `      <p style="margin:0;color:${emailColors.mutedText};font-size:12px;line-height:16px;">${renderWordmark()} <span>${escapeHtml(footerCopy.by)}</span> <a href="https://nooroctavian.id/" style="color:${emailColors.ink};font-weight:700;text-decoration:none;">${escapeHtml(footerCopy.footerAuthor)}</a></p>`,
    "    </td>",
    "  </tr>",
    "</table>",
    "    </td>",
    "  </tr>",
    "</table>",
    "</body>",
    "</html>",
  ].join("\n");
}

function renderWordmark(): string {
  return `<span style="color:${emailColors.ink};">rhasia-</span><span style="color:${emailColors.gold};">scret</span>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character,
  );
}
