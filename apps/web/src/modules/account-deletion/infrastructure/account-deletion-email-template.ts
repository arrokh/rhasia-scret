import enMessages from "../../../../messages/en.json";
import type { AccountDeletionCompletionEmail, AccountDeletionOtpEmail } from "../application/account-deletion-email";
import { emailColors, emailFontStack, renderEmailTemplate } from "@/shared/infrastructure/email-templates";

const enCopy = enMessages.Identity.accountDeletionEmail;

type Copy = typeof enCopy;

export type AccountDeletionEmailContent = Readonly<{
  subject: string;
  text: string;
  html: string;
}>;

export function renderAccountDeletionOtpEmail(email: AccountDeletionOtpEmail): AccountDeletionEmailContent {
  const subject = enCopy.otpSubject;
  return {
    subject,
    text: [enCopy.title, enCopy.description, `${enCopy.code}: ${email.otp}`, enCopy.expiry, enCopy.ignore].join("\n\n"),
    html: renderEmailTemplate({
      subject,
      content: renderOtpHtml(enCopy, email.otp),
    }),
  };
}

export function renderAccountDeletionCompletionEmail(
  email: AccountDeletionCompletionEmail,
): AccountDeletionEmailContent {
  const subject = enCopy.completionSubject;
  return {
    subject,
    text: [enCopy.completionTitle, enCopy.completionDescription, `${enCopy.receipt}: ${email.receiptId}`].join("\n\n"),
    html: renderEmailTemplate({
      subject,
      content: renderCompletionHtml(enCopy, email.receiptId),
    }),
  };
}

function renderOtpHtml(copy: Copy, otp: string): string {
  return [
    `<h1 style="margin:0 0 12px;color:${emailColors.inkStrong};font-family:${emailFontStack};font-size:24px;line-height:32px;font-weight:700;letter-spacing:-0.02em;">${escapeHtml(copy.title)}</h1>`,
    `<p style="margin:0 0 24px;color:${emailColors.ink};font-family:${emailFontStack};font-size:16px;line-height:24px;">${escapeHtml(copy.description)}</p>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 20px;">`,
    "  <tr>",
    `    <td align="center" style="padding:20px 16px;border:1px solid ${emailColors.border};border-radius:12px;background-color:${emailColors.mutedSurface};">`,
    `      <p style="margin:0 0 8px;color:${emailColors.mutedText};font-family:${emailFontStack};font-size:12px;line-height:16px;text-transform:uppercase;letter-spacing:0.08em;">${escapeHtml(copy.code)}</p>`,
    `      <p style="margin:0;color:${emailColors.inkStrong};font-family:${emailFontStack};font-size:30px;line-height:36px;font-weight:700;letter-spacing:0.3em;">${escapeHtml(otp)}</p>`,
    "    </td>",
    "  </tr>",
    "</table>",
    `<p style="margin:0 0 16px;color:${emailColors.mutedText};font-family:${emailFontStack};font-size:14px;line-height:20px;">${escapeHtml(copy.expiry)}</p>`,
    `<p style="margin:0;color:${emailColors.mutedText};font-family:${emailFontStack};font-size:12px;line-height:16px;">${escapeHtml(copy.ignore)}</p>`,
  ].join("\n");
}

function renderCompletionHtml(copy: Copy, receiptId: string): string {
  return [
    `<h1 style="margin:0 0 12px;color:${emailColors.inkStrong};font-family:${emailFontStack};font-size:24px;line-height:32px;font-weight:700;letter-spacing:-0.02em;">${escapeHtml(copy.completionTitle)}</h1>`,
    `<p style="margin:0 0 24px;color:${emailColors.ink};font-family:${emailFontStack};font-size:16px;line-height:24px;">${escapeHtml(copy.completionDescription)}</p>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0;">`,
    "  <tr>",
    `    <td style="padding:16px;border-left:3px solid ${emailColors.gold};border-radius:8px;background-color:${emailColors.mutedSurface};">`,
    `      <p style="margin:0 0 8px;color:${emailColors.mutedText};font-family:${emailFontStack};font-size:12px;line-height:16px;text-transform:uppercase;letter-spacing:0.08em;">${escapeHtml(copy.receipt)}</p>`,
    `      <p style="margin:0;color:${emailColors.inkStrong};font-family:${emailFontStack};font-size:16px;line-height:24px;font-weight:700;overflow-wrap:anywhere;word-break:break-all;">${escapeHtml(receiptId)}</p>`,
    "    </td>",
    "  </tr>",
    "</table>",
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character,
  );
}
