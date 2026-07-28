export async function measureServerOperation<T>(name: `rhsia:${string}`, operation: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    if (process.env.PERFORMANCE_DIAGNOSTICS === "1") {
      const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
      console.info(JSON.stringify({ type: "performance", name, durationMs }));
    }
  }
}
