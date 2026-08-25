import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createRetentionPurgeService, type RetentionPurgeReport } from "@/modules/retention/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RetentionLogger = {
  info(event: Record<string, unknown>): void;
  error(event: Record<string, unknown>): void;
};

type Dependencies = {
  secret: string | undefined;
  purge: () => Promise<RetentionPurgeReport>;
  logger: RetentionLogger;
  createJobId: () => string;
};

export function createRetentionPurgeHandler({ secret, purge, logger, createJobId }: Dependencies) {
  return async function GET(request: Request) {
    if (!secret || secret.length < 32) return json({ error: "retention_purge_not_configured" }, 503);
    if (!authorized(request.headers.get("authorization"), secret)) return json({ error: "unauthorized" }, 401);

    const jobId = createJobId();
    try {
      const report = await purge();
      logger.info({
        event: "retention_purge_completed",
        jobId,
        accountCount: report.accountIds.length,
        accountIds: report.accountIds,
        vaultCount: report.vaultIds.length,
        vaultIds: report.vaultIds,
        auditEventCount: report.auditEventIds.length,
        auditEventIds: report.auditEventIds,
        accountBacklogRemaining: report.accountBacklogRemaining,
        vaultBacklogRemaining: report.vaultBacklogRemaining,
        auditBacklogRemaining: report.auditBacklogRemaining
      });
      return json({
        jobId,
        accountCount: report.accountIds.length,
        vaultCount: report.vaultIds.length,
        auditEventCount: report.auditEventIds.length,
        accountBacklogRemaining: report.accountBacklogRemaining,
        vaultBacklogRemaining: report.vaultBacklogRemaining,
        auditBacklogRemaining: report.auditBacklogRemaining
      });
    } catch {
      logger.error({ event: "retention_purge_failed", jobId });
      return json({ error: "retention_purge_failed", jobId }, 500);
    }
  };
}

function json(body: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

function authorized(header: string | null, secret: string): boolean {
  const provided = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return timingSafeEqual(digest(provided), digest(secret));
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

const purgeRetention = createRetentionPurgeService();

export const GET = createRetentionPurgeHandler({
  secret: process.env.CRON_SECRET,
  purge: () => purgeRetention(new Date()),
  logger: { info: (event) => console.info(JSON.stringify(event)), error: (event) => console.error(JSON.stringify(event)) },
  createJobId: randomUUID
});
