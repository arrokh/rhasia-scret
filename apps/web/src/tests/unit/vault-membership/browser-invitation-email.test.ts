/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { buildInvitationEmailUrl } from "@/modules/vault-membership/infrastructure/browser-invitation-email";

describe("browser invitation email delivery", () => {
  it("builds a mailto draft without sending the link to an application endpoint", () => {
    const url = buildInvitationEmailUrl({
      recipientEmail: "viewer@example.test",
      subject: "Shared Vault invitation",
      body: "Open this one-time link:\nhttps://app.example.test/vaults/invitations/redeem#client-only-secret",
    });

    expect(url).toBe(
      "mailto:viewer%40example.test?subject=Shared+Vault+invitation&body=Open+this+one-time+link%3A%0Ahttps%3A%2F%2Fapp.example.test%2Fvaults%2Finvitations%2Fredeem%23client-only-secret",
    );
    expect(url).not.toContain("/api/v1/");
  });
});
