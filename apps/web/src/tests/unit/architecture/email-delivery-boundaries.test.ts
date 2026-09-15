import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("magic-link email delivery boundaries", () => {
  it("keeps Nodemailer and SMTP credentials server-only", () => {
    const clientSources = [
      "src/modules/identity/presentation/email-sign-in-form.tsx",
      "src/modules/identity/presentation/request-email-sign-in-link.ts",
      "src/modules/identity/infrastructure/browser-passwordless-client.ts",
      "../../apps/mobile/src/presentation/use-mobile-session.ts",
      "../../apps/mobile/src/infrastructure/mobile-passwordless-auth-client.ts",
    ];
    for (const path of clientSources)
      expect(read(path)).not.toMatch(/nodemailer|SMTP_PASSWORD|AUTH_MAGIC_LINK_SECRET|AUTH_SESSION_SECRET/i);

    expect(read("src/shared/infrastructure/nodemailer-transport.ts")).toContain('from "nodemailer"');
    expect(read("src/modules/account-deletion/infrastructure/nodemailer-account-deletion-email-sender.ts")).not.toMatch(
      /console\.(log|error)/i,
    );
    expect(read("src/app/api/auth/magic-link/request/route.ts")).not.toMatch(/console\.(log|error).*email/i);
  });
});
