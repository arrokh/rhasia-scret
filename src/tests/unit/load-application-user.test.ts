import { describe, expect, it } from "vitest";
import { loadApplicationUser } from "@/modules/identity";
import { ApplicationUser } from "@/modules/identity/domain/application-user";
import { FakeSessionVerifier } from "@/modules/identity/infrastructure/fake-session-verifier";

describe("loadApplicationUser", () => {
  it("does not provision without a verified session", async () => {
    const applicationUsers = { provision: async () => { throw new Error("must not provision"); } };
    await expect(loadApplicationUser(new FakeSessionVerifier(null), applicationUsers)).resolves.toBeNull();
  });

  it("provisions an application user from the verified Supabase identity", async () => {
    const session = { subject: "subject-1", email: "person@example.test" };
    const applicationUsers = {
      provision: async (received: typeof session) => new ApplicationUser("user-1", "supabase", received.subject, received.email, "ACTIVE")
    };
    await expect(loadApplicationUser(new FakeSessionVerifier(session), applicationUsers)).resolves.toMatchObject({
      id: "user-1",
      subject: "subject-1",
      email: "person@example.test"
    });
  });
});
