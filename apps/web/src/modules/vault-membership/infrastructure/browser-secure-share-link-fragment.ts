import { consumeBrowserLocationFragment } from "@/shared/infrastructure/browser-location-fragment";

// A 32-byte AES key has exactly 43 unpadded Base64URL characters; shorter anchors are not invitation secrets.
const SECURE_SHARE_LINK_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function consumeSecureShareLinkSecretFromLocation(options: { clearInvalidFragment?: boolean } = {}): string {
  try {
    const fragment = typeof window === "undefined" ? "" : window.location.hash.slice(1);
    if (!fragment) return "";
    const isSecret = SECURE_SHARE_LINK_SECRET_PATTERN.test(fragment);
    if (!isSecret && options.clearInvalidFragment === false) return "";
    const secret = consumeBrowserLocationFragment();
    if (!secret) return "";
    return SECURE_SHARE_LINK_SECRET_PATTERN.test(secret) ? secret : "";
  } catch {
    return "";
  }
}
