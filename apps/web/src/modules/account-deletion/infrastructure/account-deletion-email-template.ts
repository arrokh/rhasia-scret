import idMessages from "../../../../messages/id.json";
import enMessages from "../../../../messages/en.json";
import type { AccountDeletionCompletionEmail, AccountDeletionOtpEmail } from "../application/account-deletion-email";

const idCopy = idMessages.Identity.accountDeletionEmail;
const enCopy = enMessages.Identity.accountDeletionEmail;

type Copy = typeof idCopy;

export type AccountDeletionEmailContent = Readonly<{
  subject: string;
  text: string;
  html: string;
}>;

export function renderAccountDeletionOtpEmail(email: AccountDeletionOtpEmail): AccountDeletionEmailContent {
  return render(
    idCopy,
    enCopy,
    (copy) => [copy.title, copy.description, `${copy.code}: ${email.otp}`, copy.expiry, copy.ignore].join("\n\n"),
    (copy) =>
      [
        `<h1>${escapeHtml(copy.title)}</h1>`,
        `<p>${escapeHtml(copy.description)}</p>`,
        `<p style="font-size:28px;letter-spacing:.3em;font-weight:700">${escapeHtml(email.otp)}</p>`,
        `<p>${escapeHtml(copy.expiry)}</p>`,
        `<p style="color:#687386;font-size:13px">${escapeHtml(copy.ignore)}</p>`,
      ].join("\n"),
  );
}

export function renderAccountDeletionCompletionEmail(
  email: AccountDeletionCompletionEmail,
): AccountDeletionEmailContent {
  return render(
    idCopy,
    enCopy,
    (copy) => [copy.completionTitle, copy.completionDescription, `${copy.receipt}: ${email.receiptId}`].join("\n\n"),
    (copy) =>
      [
        `<h1>${escapeHtml(copy.completionTitle)}</h1>`,
        `<p>${escapeHtml(copy.completionDescription)}</p>`,
        `<p>${escapeHtml(copy.receipt)}: <strong>${escapeHtml(email.receiptId)}</strong></p>`,
      ].join("\n"),
  );
}

function render(
  id: Copy,
  en: Copy,
  textSection: (copy: Copy) => string,
  htmlSection: (copy: Copy) => string,
): AccountDeletionEmailContent {
  return {
    subject: `${id.subject} / ${en.subject}`,
    text: [textSection(id), textSection(en)].join("\n\n---\n\n"),
    html: [htmlSection(id), htmlSection(en)].join('<hr style="border:0;border-top:1px solid #d9dee8;margin:32px 0">'),
  };
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character,
  );
}
