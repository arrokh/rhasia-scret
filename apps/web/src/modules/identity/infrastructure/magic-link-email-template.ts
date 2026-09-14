import idMessages from "../../../../messages/id.json";
import enMessages from "../../../../messages/en.json";

const idCopy = idMessages.Identity.magicLinkEmail;
const enCopy = enMessages.Identity.magicLinkEmail;

export type MagicLinkEmailContent = Readonly<{
  subject: string;
  text: string;
  html: string;
}>;

export function renderMagicLinkEmail(actionUrl: URL): MagicLinkEmailContent {
  const link = actionUrl.toString();
  const escapedLink = escapeHtml(link);
  return {
    subject: `${idCopy.subject} / ${enCopy.subject}`,
    text: [renderTextSection(idCopy, link), renderTextSection(enCopy, link)].join("\n\n---\n\n"),
    html: [renderHtmlSection(idCopy, escapedLink), renderHtmlSection(enCopy, escapedLink)].join(
      '<hr style="border:0;border-top:1px solid #d9dee8;margin:32px 0">',
    ),
  };
}

type Copy = typeof idCopy;

function renderTextSection(copy: Copy, link: string): string {
  return [
    copy.language,
    copy.title,
    copy.description,
    `${copy.button}: ${link}`,
    `${copy.fallback}\n${link}`,
    copy.ignore,
  ].join("\n\n");
}

function renderHtmlSection(copy: Copy, link: string): string {
  return [
    `<p style="color:#687386;font-size:12px;text-transform:uppercase;letter-spacing:.08em">${escapeHtml(copy.language)}</p>`,
    `<h1>${escapeHtml(copy.title)}</h1>`,
    `<p>${escapeHtml(copy.description)}</p>`,
    `<p><a href="${link}" style="background:#272b68;color:#fff;display:inline-block;padding:12px 20px;text-decoration:none;border-radius:6px">${escapeHtml(copy.button)}</a></p>`,
    `<p>${escapeHtml(copy.fallback)}<br><a href="${link}">${link}</a></p>`,
    `<p style="color:#687386;font-size:13px">${escapeHtml(copy.ignore)}</p>`,
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character,
  );
}
