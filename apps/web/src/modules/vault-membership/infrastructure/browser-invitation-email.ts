"use client";

type InvitationEmail = {
  recipientEmail: string;
  subject: string;
  body: string;
};

export function buildInvitationEmailUrl({ recipientEmail, subject, body }: InvitationEmail): string {
  const parameters = new URLSearchParams({ subject, body });
  return `mailto:${encodeURIComponent(recipientEmail)}?${parameters.toString()}`;
}

export function openInvitationEmailComposer(email: InvitationEmail): void {
  window.location.assign(buildInvitationEmailUrl(email));
}
