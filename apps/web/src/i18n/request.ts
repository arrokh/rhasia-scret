import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { deterministicTimeZone, localeCookieName, resolveLocale, type AppLocale } from "./config";

const messageLoaders: Record<AppLocale, () => Promise<{ default: Record<string, unknown> }>> = {
  id: () => import("../../messages/id.json"),
  en: () => import("../../messages/en.json")
};

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const locale = resolveLocale(cookieStore.get(localeCookieName)?.value);
  return {
    locale,
    messages: (await messageLoaders[locale]()).default,
    timeZone: deterministicTimeZone
  };
});
