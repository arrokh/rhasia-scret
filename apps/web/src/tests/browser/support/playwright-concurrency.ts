export function configuredPlaywrightWorkers(fallback: number | string | undefined): number | string | undefined {
  const value = process.env.PLAYWRIGHT_WORKERS?.trim();
  if (!value) return fallback;
  if (/^[1-9]\d*$/.test(value)) return Number(value);
  if (/^(?:\d+(?:\.\d+)?|\.\d+)%$/.test(value) && Number.parseFloat(value) > 0) return value;
  throw new Error("PLAYWRIGHT_WORKERS must be a positive integer or percentage, such as 3 or 50%.");
}

export function configuredPlaywrightFullyParallel(fallback: boolean): boolean {
  const value = process.env.PLAYWRIGHT_FULLY_PARALLEL?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  throw new Error("PLAYWRIGHT_FULLY_PARALLEL must be 1, 0, true, or false.");
}
