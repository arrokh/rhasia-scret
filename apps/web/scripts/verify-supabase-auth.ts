import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(scriptDirectory, "../.env") });
loadDotenv({ path: resolve(scriptDirectory, "../../../.env") });

type SupabaseAuthSettings = {
  disable_signup?: boolean;
  mailer_autoconfirm?: boolean;
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase URL or publishable key is missing.");

  const response = await fetch(`${url.replace(/\/$/, "")}/auth/v1/settings`, {
    headers: { apikey: key },
  });
  if (!response.ok) {
    throw new Error(`Supabase Auth settings request failed with HTTP ${response.status}.`);
  }

  const settings: SupabaseAuthSettings = await response.json();
  const publicEmailSignupEnabled = settings.disable_signup === false;
  const confirmEmailEnabled = settings.mailer_autoconfirm === false;
  console.log(JSON.stringify({
    authReachable: true,
    httpStatus: response.status,
    publicEmailSignupEnabled,
    confirmEmailEnabled,
  }));
  if (!publicEmailSignupEnabled || !confirmEmailEnabled) {
    throw new Error("Supabase Auth must allow public signup and require email confirmation.");
  }
}

void main();
