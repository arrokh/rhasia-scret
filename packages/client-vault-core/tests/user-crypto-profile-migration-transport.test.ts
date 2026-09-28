import { describe, expect, it } from "vitest";
import {
  commitUserCryptoProfileMigration,
  type AuthenticatedTransport,
  type PlatformHttpRequest,
  type PlatformHttpResponse,
} from "../src/index";

describe("User Crypto Profile migration transport", () => {
  it("retries the identical opaque CAS request once after transient uncertainty", async () => {
    const requests: PlatformHttpRequest[] = [];
    let attempts = 0;
    const transport: AuthenticatedTransport = {
      async request(request) {
        requests.push(request);
        attempts += 1;
        if (attempts === 1) throw new Error("synthetic transient network failure");
        return response(204);
      },
    };
    const migration = {
      encryptedPersonalVaultKey: {
        expectedCiphertext: envelope(1, 4),
        replacementCiphertext: envelope(2, 5),
      },
    };

    await expect(commitUserCryptoProfileMigration(transport, migration)).resolves.toBe("committed");

    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe("/v1/user-crypto-profile/migration");
    expect(requests[0]?.method).toBe("POST");
    expect(requests[1]?.body).toBe(requests[0]?.body);
  });

  it("does not retry an explicit CAS conflict or an aborted request", async () => {
    let conflictAttempts = 0;
    const conflictTransport: AuthenticatedTransport = {
      async request() {
        conflictAttempts += 1;
        return response(409);
      },
    };
    await expect(
      commitUserCryptoProfileMigration(conflictTransport, {
        wrappedUserRootKey: { expectedCiphertext: envelope(1, 6), replacementCiphertext: envelope(2, 7) },
      }),
    ).resolves.toBe("conflict");
    expect(conflictAttempts).toBe(1);

    let abortAttempts = 0;
    const abortTransport: AuthenticatedTransport = {
      async request() {
        abortAttempts += 1;
        const error = new Error("synthetic cancellation");
        error.name = "AbortError";
        throw error;
      },
    };
    await expect(
      commitUserCryptoProfileMigration(abortTransport, {
        wrappedUserRootKey: { expectedCiphertext: envelope(1, 8), replacementCiphertext: envelope(2, 9) },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(abortAttempts).toBe(1);
  });
});

function envelope(version: number, value: number): Uint8Array {
  return Uint8Array.from({ length: 64 }, (_, index) => (index === 0 ? version : value));
}

function response(status: number): PlatformHttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json<T>() {
      return Promise.reject(new Error("No JSON response is available."));
    },
    async bytes() {
      return new Uint8Array();
    },
    async text() {
      return "";
    },
  };
}
