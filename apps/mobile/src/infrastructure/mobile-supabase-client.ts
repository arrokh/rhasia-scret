import "react-native-url-polyfill/auto";

import { createClient, processLock, type SupabaseClient } from "@supabase/supabase-js";
import type { MobileClientConfiguration } from "../config";
import { SecureSupabaseSessionStorage } from "./secure-session-storage";

export function createMobileSupabaseClient(
  configuration: MobileClientConfiguration,
  storage = new SecureSupabaseSessionStorage(),
): SupabaseClient {
  return createClient(configuration.supabaseUrl, configuration.supabasePublishableKey, {
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: "pkce",
      lock: processLock,
    },
    global: {
      headers: { "x-client-info": "rhasia-scret-mobile/0.1.0" },
    },
  });
}
