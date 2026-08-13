import { describe, expect, it } from "vitest";
import { ApplicationUser } from "@/modules/identity";

describe("ApplicationUser", () => {
  it("allows an active invited user to access the application", () => {
    const user = new ApplicationUser("user-1", "supabase", "supabase-1", "person@example.test", "ACTIVE");
    expect(user.canAccessApplication()).toBe(true);
  });

  it("denies an inactive user", () => {
    const user = new ApplicationUser("user-1", "supabase", "supabase-1", "person@example.test", "INACTIVE");
    expect(user.canAccessApplication()).toBe(false);
  });
});
