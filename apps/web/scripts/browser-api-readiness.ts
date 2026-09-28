export type BrowserApiHealthProbe = (origin: string) => Promise<boolean>;

export async function waitForBrowserApi(
  origin: string,
  readStartupFailure: () => string | undefined,
  healthProbe: BrowserApiHealthProbe = async (apiOrigin) => (await fetch(`${apiOrigin}/v1/health`)).ok,
): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const startupFailure = readStartupFailure();
    if (startupFailure) throw new Error(startupFailure);

    try {
      if (await healthProbe(origin)) return;
    } catch {
      // The API process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const startupFailure = readStartupFailure();
  if (startupFailure) throw new Error(startupFailure);
  throw new Error("Timed out waiting for the API browser-test server.");
}
