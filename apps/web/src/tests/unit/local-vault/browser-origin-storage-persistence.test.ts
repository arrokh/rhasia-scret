import { describe, expect, it } from "vitest";
import {
  BrowserOriginStoragePersistenceClient,
  type OriginStoragePersistenceManager,
} from "@/modules/local-vault/infrastructure/browser-origin-storage-persistence";

describe("BrowserOriginStoragePersistenceClient", () => {
  it("reads an existing grant without requesting persistence", async () => {
    const calls: string[] = [];
    const client = new BrowserOriginStoragePersistenceClient(() => ({
      persisted: async () => {
        calls.push("persisted");
        return true;
      },
      persist: async () => {
        calls.push("persist");
        return true;
      },
    }));

    await expect(client.readStatus()).resolves.toBe("already_granted");
    expect(calls).toEqual(["persisted"]);
  });

  it("requests only after an explicit caller action and reports a new grant", async () => {
    const calls: string[] = [];
    const manager: OriginStoragePersistenceManager = {
      persisted: async () => {
        calls.push("persisted");
        return false;
      },
      persist: async () => {
        calls.push("persist");
        return true;
      },
    };
    const client = new BrowserOriginStoragePersistenceClient(() => manager);

    await expect(client.readStatus()).resolves.toBe("not_granted");
    expect(calls).toEqual(["persisted"]);
    await expect(client.request()).resolves.toBe("granted");
    expect(calls).toEqual(["persisted", "persisted", "persist"]);
  });

  it("reports denial, unavailable support, and browser errors without throwing", async () => {
    const denied = new BrowserOriginStoragePersistenceClient(() => ({
      persisted: async () => false,
      persist: async () => false,
    }));
    const unavailable = new BrowserOriginStoragePersistenceClient(() => null);
    const failingManager: OriginStoragePersistenceManager = {
      persisted: async () => {
        throw new Error("synthetic storage failure");
      },
      persist: async () => true,
    };
    const failing = new BrowserOriginStoragePersistenceClient(() => failingManager);

    await expect(denied.request()).resolves.toBe("denied");
    await expect(unavailable.readStatus()).resolves.toBe("unavailable");
    await expect(unavailable.request()).resolves.toBe("unavailable");
    const requestFailure = new BrowserOriginStoragePersistenceClient(() => ({
      persisted: async () => false,
      persist: async () => {
        throw new Error("synthetic persistence request failure");
      },
    }));

    await expect(failing.readStatus()).resolves.toBe("error");
    await expect(failing.request()).resolves.toBe("error");
    await expect(requestFailure.request()).resolves.toBe("error");
  });

  it("does not request persistence again when permission is already granted", async () => {
    const calls: string[] = [];
    const client = new BrowserOriginStoragePersistenceClient(() => ({
      persisted: async () => {
        calls.push("persisted");
        return true;
      },
      persist: async () => {
        calls.push("persist");
        return true;
      },
    }));

    await expect(client.request()).resolves.toBe("already_granted");
    expect(calls).toEqual(["persisted"]);
  });
});
