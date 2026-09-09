import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("retention purge architecture", () => {
  it("schedules the authenticated production endpoint once per day", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "../../vercel.json"), "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    expect(config.crons).toEqual([{ path: "/api/internal/retention-purge", schedule: "0 3 * * *" }]);
    const example = readFileSync(join(process.cwd(), "../../.env.example"), "utf8");
    expect(example).toContain("CRON_SECRET=");
  });

  it("keeps purge repositories server-side and never selects encrypted content", () => {
    const accountPurge = readFileSync(
      join(
        process.cwd(),
        "src/modules/authenticator-account/infrastructure/prisma-expired-account-purge-repository.ts",
      ),
      "utf8",
    );
    const vaultPurge = readFileSync(
      join(process.cwd(), "src/modules/vault-management/infrastructure/prisma-expired-vault-retention-repository.ts"),
      "utf8",
    );
    const route = readFileSync(join(process.cwd(), "src/app/api/internal/retention-purge/route.ts"), "utf8");
    expect(accountPurge).not.toMatch(/encryptedPayload|encrypted_payload/);
    expect(vaultPurge).not.toMatch(/encryptedName|encrypted_name|encryptedPayload|encrypted_payload/);
    expect(route).not.toMatch(/error\.message|String\(error\)|console\.(?:info|error)\(error/);
    expect(route).toContain("accountIds: report.accountIds");
    expect(route).toContain("auditEventIds: report.auditEventIds");
  });
});
