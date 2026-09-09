import type {
  ApplicationRateLimitMetrics,
  ApplicationRateLimitOutcome,
} from "../application/check-application-rate-limit";
import type { ApplicationRateLimitPolicyId } from "../domain/application-rate-limit-policy";

const REPORT_INTERVAL_MS = 60_000;
const MAX_COUNT = 2_147_483_647;

type OutcomeStatus = ApplicationRateLimitOutcome["status"];
type MetricKey = `${ApplicationRateLimitPolicyId}:${OutcomeStatus}`;

export class BoundedRateLimitMetrics implements ApplicationRateLimitMetrics {
  private windowStartedAt: number;
  private counts = new Map<MetricKey, number>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly report: (line: string) => void = console.info,
  ) {
    this.windowStartedAt = now();
  }

  record(operation: ApplicationRateLimitPolicyId, outcome: OutcomeStatus): void {
    const currentTime = this.now();
    if (currentTime - this.windowStartedAt >= REPORT_INTERVAL_MS) this.flush(currentTime);
    const key: MetricKey = `${operation}:${outcome}`;
    this.counts.set(key, Math.min((this.counts.get(key) ?? 0) + 1, MAX_COUNT));
  }

  private flush(currentTime: number): void {
    if (this.counts.size > 0) {
      this.report(
        JSON.stringify({
          event: "application_rate_limit_metrics",
          windowStartedAt: new Date(this.windowStartedAt).toISOString(),
          windowSeconds: REPORT_INTERVAL_MS / 1_000,
          counts: Object.fromEntries([...this.counts.entries()].sort(([left], [right]) => left.localeCompare(right))),
        }),
      );
    }
    this.counts.clear();
    this.windowStartedAt = currentTime;
  }
}
