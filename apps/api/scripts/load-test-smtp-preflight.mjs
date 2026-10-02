import { createSmtpEmailSenders } from "../src/smtp-email-senders.ts";
import { readApiConfigBindings } from "../src/runtime/environment.ts";

async function main() {
  const senders = createSmtpEmailSenders(readApiConfigBindings(process.env));
  await senders.magicLink.sendMagicLinkEmail({
    recipientEmail: "smtp-preflight@loadtest.invalid",
    actionUrl: new URL("http://localhost:4000/smtp-preflight"),
  });
  process.stdout.write("smtp-preflight=sent\n");
}

main().catch(() => {
  process.stderr.write("smtp-preflight=failed\n");
  process.exitCode = 1;
});
