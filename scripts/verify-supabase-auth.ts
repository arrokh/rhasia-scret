import "dotenv/config";

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

  const settings: { external?: { email?: { enabled?: boolean } } } = await response.json();
  console.log(JSON.stringify({
    authReachable: true,
    httpStatus: response.status,
    externalEmailEnabled: Boolean(settings.external?.email?.enabled),
  }));
}

void main();
