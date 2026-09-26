import type { AccountDeletionEmailSender } from "@api/modules/account-deletion/application/account-deletion-email";
import type { MagicLinkEmailSender } from "@api/modules/identity/application/email-delivery";
import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";

/** Runtime configuration is composed by the Bun, Node.js, or Vercel adapter. */
export type ApiBindings = Readonly<{
  WEB_ORIGIN?: string;
  PROXY_SECRET?: string;
  AUTH_BACKEND?: string;
  AUTH_APP_ORIGIN?: string;
  AUTH_MOBILE_REDIRECT_URL?: string;
  AUTH_MAGIC_LINK_SECRET?: string;
  AUTH_SESSION_SECRET?: string;
  TURNSTILE_SECRET_KEY?: string;
  CRON_SECRET?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_SECURE?: string;
  SMTP_REQUIRE_TLS?: string;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  AUTH_EMAIL_FROM?: string;
  AUTH_EMAIL_FROM_NAME?: string;
  AUTH_MAGIC_LINK_TTL_SECONDS?: string;
  AUTH_ACCESS_TOKEN_TTL_SECONDS?: string;
  AUTH_REFRESH_TOKEN_TTL_SECONDS?: string;
  NODE_ENV?: string;
  /** Development-only browser E2E session configuration; never set in production. */
  E2E_BROWSER_TESTS?: string;
  E2E_BROWSER_TEST_USERS?: string;
  PASSKEY_RP_ID?: string;
  PASSKEY_ORIGIN?: string;
  /** Process-scoped client supplied by a standalone runtime adapter. */
  DATABASE_CLIENT?: PrismaDatabase;
  /** Process-scoped email delivery ports supplied by a runtime adapter. */
  EMAIL_SENDERS: ApiEmailSenders;
}>;

export type ApiEmailSenders = Readonly<{
  magicLink: MagicLinkEmailSender;
  accountDeletion: AccountDeletionEmailSender;
}>;

export type ApiConfigBindings = Omit<ApiBindings, "EMAIL_SENDERS">;

export type ApiEnvironment = {
  Bindings: ApiBindings;
  Variables: {
    requestId: string;
    proxyRequest: boolean;
    apiRequest: import("@api/http/api-request").ApiRequest;
  };
};
