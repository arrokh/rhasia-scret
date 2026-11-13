import type { CompareOperation } from "./runtime-parity-types";

export async function runSystemParityScenarios(compare: CompareOperation, cronSecret: string): Promise<void> {
  await compare({
    name: "database-independent-health-probe",
    method: "GET",
    path: "/v1/health",
    expectedStatus: 200,
  });
  await compare({
    name: "database-independent-time-probe",
    method: "GET",
    path: "/v1/time",
    expectedStatus: 200,
  });
  await compare({
    name: "authorized-retention-purge",
    method: "GET",
    path: "/v1/internal/retention-purge",
    expectedStatus: 200,
    headers: { authorization: `Bearer ${cronSecret}` },
  });
}
