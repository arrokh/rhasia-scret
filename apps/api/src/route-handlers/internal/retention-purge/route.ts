import { getApiRequestContext } from "@api/http/api-context";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { createRetentionPurgeService, type RetentionPurgeReport } from "@api/modules/retention/server";
import { constantTimeEqual, sha256Digest, randomUuidWithoutDashes } from "@api/shared/infrastructure/crypto";

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
        vaultCount: report.vaultIds.length,
        auditEventCount: report.auditEventIds.length,
        authRecordsPurged: report.authRecordsPurged,
        accountBacklogRemaining: report.accountBacklogRemaining,
        vaultBacklogRemaining: report.vaultBacklogRemaining,
        auditBacklogRemaining: report.auditBacklogRemaining,
      });
      return json({
        jobId,
        accountCount: report.accountIds.length,
        vaultCount: report.vaultIds.length,
        auditEventCount: report.auditEventIds.length,
        authRecordsPurged: report.authRecordsPurged,
        accountBacklogRemaining: report.accountBacklogRemaining,
        vaultBacklogRemaining: report.vaultBacklogRemaining,
        auditBacklogRemaining: report.auditBacklogRemaining,
      });
    } catch {
      logger.error({ event: "retention_purge_failed", jobId });
      return json({ error: "retention_purge_failed", jobId }, 500);
    }
  };
}

function json(body: Record<string, unknown>, status = 200): ApiResponse {
  return ApiResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

function authorized(header: string | null, secret: string): boolean {
  const provided = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return constantTimeEqual(sha256Digest(provided), sha256Digest(secret));
}

export async function GET(request: ApiRequest) {
  const context = getApiRequestContext(request);
  return createRetentionPurgeHandler({
    secret: context.bindings.CRON_SECRET,
    purge: () => createRetentionPurgeService(context.database)(new Date()),
    logger: {
      info: (event) => console.info(JSON.stringify(event)),
      error: (event) => console.error(JSON.stringify(event)),
    },
    createJobId: randomUuidWithoutDashes,
  })(request);
}
