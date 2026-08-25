import { describe, expect, it } from "vitest";
import { invitationExpiresAt, invitationIsExpired } from "@/modules/vault-membership/domain/invitation-expiry";

describe("Invitation expiry", () => {
  const createdAt = new Date("2026-07-29T12:00:00.000Z");
  const expiresAt = new Date("2026-08-05T12:00:00.000Z");

  it("expires a Secure Share Link exactly seven days after creation", () => {
    expect(invitationExpiresAt(createdAt)).toEqual(expiresAt);
    expect(invitationIsExpired(expiresAt, new Date("2026-08-05T11:59:59.999Z"))).toBe(false);
    expect(invitationIsExpired(expiresAt, expiresAt)).toBe(true);
  });
});
