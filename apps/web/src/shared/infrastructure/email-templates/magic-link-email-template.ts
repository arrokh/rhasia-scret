import enMessages from "../../../../messages/en.json";
import { emailColors, emailFontStack, renderEmailTemplate } from "./email-template-layout";

const enCopy = enMessages.Identity.magicLinkEmail;

export type MagicLinkEmailContent = Readonly<{
  subject: string;
  text: string;
  html: string;
}>;

export function renderMagicLinkEmail(actionUrl: URL): MagicLinkEmailContent {
  const link = actionUrl.toString();
  const escapedLink = escapeHtml(link);
  const subject = enCopy.subject;

  return {
    subject,
    text: renderTextSection(enCopy, link),
    html: renderEmailTemplate({
      subject,
      content: renderHtmlSection(enCopy, escapedLink),
    }),
  };
}

type Copy = typeof enCopy;

function renderTextSection(copy: Copy, link: string): string {
  return [copy.title, copy.description, `${copy.button}: ${link}`, `${copy.fallback}\n${link}`, copy.ignore].join(
    "\n\n",
  );
}

function renderHtmlSection(copy: Copy, escapedLink: string): string {
  return [
    `<h1 style="margin:0 0 12px;color:${emailColors.inkStrong};font-size:24px;line-height:32px;font-weight:700;letter-spacing:-0.02em;">${escapeHtml(copy.title)}</h1>`,
    `<p style="margin:0 0 24px;color:${emailColors.ink};font-size:16px;line-height:24px;">${escapeHtml(copy.description)}</p>`,
    `<p style="margin:0 0 24px;"><a href="${escapedLink}" style="display:inline-block;padding:12px 20px;border-radius:12px;background-color:${emailColors.gold};color:${emailColors.inkStrong};font-family:${emailFontStack};font-size:16px;line-height:24px;font-weight:700;text-align:center;text-decoration:none;">${escapeHtml(copy.button)}</a></p>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 20px;">`,
    "  <tr>",
    `    <td style="padding:16px;border-left:3px solid ${emailColors.gold};border-radius:8px;background-color:${emailColors.mutedSurface};">`,
    `      <p style="margin:0 0 8px;color:${emailColors.ink};font-family:${emailFontStack};font-size:14px;line-height:20px;">${escapeHtml(copy.fallback)}</p>`,
    `      <a href="${escapedLink}" style="color:${emailColors.goldStrong};font-family:${emailFontStack};font-size:14px;line-height:20px;overflow-wrap:anywhere;word-break:break-all;">${escapedLink}</a>`,
    "    </td>",
    "  </tr>",
    "</table>",
    `<p style="margin:0;color:${emailColors.mutedText};font-family:${emailFontStack};font-size:12px;line-height:16px;">${escapeHtml(copy.ignore)}</p>`,
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character,
  );
}
