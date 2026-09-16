import { app } from "@api/app";
import type { ApiBindings } from "@api/types";
import { createPrismaClient } from "@api/shared/infrastructure/prisma-client";
import { createRetentionPurgeService } from "@api/modules/retention/server";

const worker = {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledController, env: ApiBindings, _ctx: ExecutionContext): Promise<void> => {
    const connectionString = env.HYPERDRIVE?.connectionString;
    if (!connectionString) {
      console.error("API retention schedule skipped: database is not configured.");
      return;
    }
    const database = createPrismaClient(connectionString);
    try {
      await createRetentionPurgeService(database)(new Date());
    } catch {
      console.error("API retention schedule failed.");
    } finally {
      await database.$disconnect();
    }
  },
};

export default worker;

export { app } from "@api/app";
export type { AppType } from "@api/app";
