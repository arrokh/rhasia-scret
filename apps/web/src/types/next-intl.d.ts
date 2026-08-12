import type idMessages from "../../messages/id.json";
import type { AppLocale } from "@/i18n/config";

declare module "next-intl" {
  interface AppConfig {
    Locale: AppLocale;
    Messages: typeof idMessages;
  }
}
