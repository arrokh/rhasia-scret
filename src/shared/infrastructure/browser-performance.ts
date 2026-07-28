"use client";

export async function measureBrowserOperation<T>(name: `rhsia:${string}`, operation: () => Promise<T>): Promise<T> {
  if (typeof performance === "undefined") return operation();
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    const duration = Math.max(0, performance.now() - startedAt);
    try { performance.measure(name, { start: startedAt, duration }); } catch { /* Performance metrics must never break product behavior. */ }
  }
}
