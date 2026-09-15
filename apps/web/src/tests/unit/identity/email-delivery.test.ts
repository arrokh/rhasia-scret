/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import { deliverMagicLinkEmail } from "@/modules/identity/application/email-delivery";

const token = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK";
const recipientEmail = "person@example.test";

afterEach(() => vi.unstubAllEnvs());

describe("magic-link email delivery", () => {
  it("allows the invitation continuation in the client-only fragment", async () => {
    const sender = { sendMagicLinkEmail: vi.fn().mockResolvedValue(undefined) };
    const actionUrl = new URL(
      `https://vault.example.test/auth/confirm#token=${token}&next=%2Fvaults%2Finvitations%2Fredeem`,
    );

    await expect(deliverMagicLinkEmail({ recipientEmail, actionUrl }, sender)).resolves.toBeUndefined();
    expect(sender.sendMagicLinkEmail).toHaveBeenCalledWith({ recipientEmail, actionUrl });
  });

  it("allows PWA callbacks with a bounded handoff identifier", async () => {
    const sender = { sendMagicLinkEmail: vi.fn().mockResolvedValue(undefined) };
    const actionUrl = new URL(
      `https://vault.example.test/auth/pwa-confirm#token=${token}&next=%2Fvaults&handoff=pwa-handoff-123456`,
    );

    await expect(deliverMagicLinkEmail({ recipientEmail, actionUrl }, sender)).resolves.toBeUndefined();
    expect(sender.sendMagicLinkEmail).toHaveBeenCalledWith({ recipientEmail, actionUrl });
  });

  it("rejects a PWA callback without a handoff identifier", async () => {
    const sender = { sendMagicLinkEmail: vi.fn() };
    const actionUrl = new URL(`https://vault.example.test/auth/pwa-confirm#token=${token}&next=%2Fvaults`);

    await expect(deliverMagicLinkEmail({ recipientEmail, actionUrl }, sender)).rejects.toThrow(
      "Magic-link email request is invalid.",
    );
    expect(sender.sendMagicLinkEmail).not.toHaveBeenCalled();
  });

  it("allows the development-only native callback scheme", async () => {
    const sender = { sendMagicLinkEmail: vi.fn().mockResolvedValue(undefined) };
    const actionUrl = new URL(`rhasia-scret://auth/magic-link#token=${token}&next=%2Fvaults`);

    await expect(deliverMagicLinkEmail({ recipientEmail, actionUrl }, sender)).resolves.toBeUndefined();
    expect(sender.sendMagicLinkEmail).toHaveBeenCalledWith({ recipientEmail, actionUrl });
  });

  it("rejects insecure web callbacks in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const sender = { sendMagicLinkEmail: vi.fn() };
    const actionUrl = new URL(`http://vault.example.test/auth/confirm#token=${token}`);

    await expect(deliverMagicLinkEmail({ recipientEmail, actionUrl }, sender)).rejects.toThrow(
      "Magic-link email request is invalid.",
    );
    expect(sender.sendMagicLinkEmail).not.toHaveBeenCalled();
  });

  it.each([
    `https://vault.example.test/auth/confirm?next=%2Fvaults#token=${token}`,
    `https://vault.example.test/auth/confirm#token=${token}&next=https%3A%2F%2Fattacker.example`,
    `https://vault.example.test/auth/confirm#token=${token}&invitation=secret`,
    `https://vault.example.test/auth/pwa-confirm#token=${token}&handoff=unsafe`,
  ])("rejects unsafe action URL data: %s", async (rawUrl) => {
    const sender = { sendMagicLinkEmail: vi.fn() };

    await expect(deliverMagicLinkEmail({ recipientEmail, actionUrl: new URL(rawUrl) }, sender)).rejects.toThrow(
      "Magic-link email request is invalid.",
    );
    expect(sender.sendMagicLinkEmail).not.toHaveBeenCalled();
  });
});
