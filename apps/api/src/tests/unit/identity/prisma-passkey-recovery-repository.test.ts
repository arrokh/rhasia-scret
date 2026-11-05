import { describe, expect, it } from "vitest";
import { PrismaPasskeyRecoveryRepository } from "@api/modules/identity/infrastructure/prisma-passkey-recovery-repository";

describe("PrismaPasskeyRecoveryRepository one-time operations", () => {
  it("returns an authentication challenge to only one concurrent caller", async () => {
    let challengeAvailable = true;
    let lockQueue = Promise.resolve();
    const transactionClient = {
      $executeRaw: async (_query: TemplateStringsArray, ..._values: unknown[]) => undefined,
      passkeyRecoveryChallenge: {
        findFirst: async () => {
          return challengeAvailable
            ? {
                id: "synthetic-challenge-id",
                challenge: "synthetic-challenge",
                expiresAt: new Date(Date.now() + 60_000),
              }
            : null;
        },
        deleteMany: async () => {
          if (!challengeAvailable) return { count: 0 };
          challengeAvailable = false;
          return { count: 1 };
        },
      },
    };
    const repository = new PrismaPasskeyRecoveryRepository({
      $transaction: async (operation: (transaction: typeof transactionClient) => Promise<string | null>) => {
        let unlock: (() => void) | undefined;
        const transaction = {
          ...transactionClient,
          $executeRaw: async (_query: TemplateStringsArray, ..._values: unknown[]) => {
            const priorTransaction = lockQueue;
            let releaseCurrent!: () => void;
            lockQueue = new Promise<void>((resolve) => {
              releaseCurrent = resolve;
            });
            await priorTransaction;
            unlock = releaseCurrent;
            return undefined;
          },
        };
        try {
          return await operation(transaction);
        } finally {
          unlock?.();
        }
      },
    } as never);

    const consumed = await Promise.all([
      repository.consumeChallenge("synthetic-user-id", "AUTHENTICATION"),
      repository.consumeChallenge("synthetic-user-id", "AUTHENTICATION"),
    ]);

    expect(consumed.filter(Boolean)).toEqual(["synthetic-challenge"]);
  });

  it("rejects a stale passkey counter write after the credential changes", async () => {
    let currentCounter = 3n;
    const repository = new PrismaPasskeyRecoveryRepository({
      passkeyRecoveryCredential: {
        updateMany: async (input: {
          where: { counter: bigint; credentialId: Uint8Array };
          data: { counter: bigint };
        }) => {
          if (
            currentCounter !== input.where.counter ||
            Buffer.compare(Buffer.from(input.where.credentialId), Buffer.from([1, 2, 3])) !== 0
          )
            return { count: 0 };
          currentCounter = input.data.counter;
          return { count: 1 };
        },
      },
    } as never);

    const first = await repository.updateCounter("synthetic-user-id", Uint8Array.of(1, 2, 3), 3n, 4n);
    const stale = await repository.updateCounter("synthetic-user-id", Uint8Array.of(1, 2, 3), 3n, 5n);

    expect(first).toBe(true);
    expect(stale).toBe(false);
    expect(currentCounter).toBe(4n);
  });
});
