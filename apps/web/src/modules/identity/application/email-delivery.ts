export type MagicLinkEmail = Readonly<{
  recipientEmail: string;
  actionUrl: URL;
}>;

export interface MagicLinkEmailSender {
  sendMagicLinkEmail(email: MagicLinkEmail): Promise<void>;
}

export async function deliverMagicLinkEmail(email: MagicLinkEmail, sender: MagicLinkEmailSender): Promise<void> {
  if (!isEmail(email.recipientEmail) || !isSafeActionUrl(email.actionUrl)) {
    throw new Error("Magic-link email request is invalid.");
  }
  await sender.sendMagicLinkEmail(email);
}

function isEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isSafeActionUrl(value: URL): boolean {
  const isWebActionUrl =
    value.protocol === "https:" || (process.env.NODE_ENV !== "production" && value.protocol === "http:");
  const isDevelopmentMobileActionUrl =
    process.env.NODE_ENV !== "production" &&
    value.protocol === "rhasia-scret:" &&
    value.hostname === "auth" &&
    value.port === "" &&
    value.pathname === "/magic-link";
  if (
    (!isWebActionUrl && !isDevelopmentMobileActionUrl) ||
    value.username ||
    value.password ||
    value.search !== "" ||
    !value.hash.startsWith("#token=")
  )
    return false;

  const fragment = new URLSearchParams(value.hash.slice(1));
  const token = fragment.get("token");
  const nextPaths = fragment.getAll("next");
  return (
    fragment.getAll("token").length === 1 &&
    nextPaths.length <= 1 &&
    [...fragment.keys()].every((key) => key === "token" || key === "next") &&
    !!token &&
    /^[A-Za-z0-9_-]{43,128}$/.test(token) &&
    (nextPaths.length === 0 || nextPaths[0] === "/vaults" || nextPaths[0] === "/vaults/invitations/redeem")
  );
}
