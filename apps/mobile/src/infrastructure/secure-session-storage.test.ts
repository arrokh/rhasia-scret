import { SecureMobileSessionStorage, type SecureStorageDriver } from "./secure-session-storage";

describe("SecureMobileSessionStorage", () => {
  it("keeps session values behind the native secure-storage driver", async () => {
    const records = new Map<string, string>();
    const driver: SecureStorageDriver = {
      getItem: jest.fn(async (key) => records.get(key) ?? null),
      setItem: jest.fn(async (key, value) => {
        records.set(key, value);
      }),
      removeItem: jest.fn(async (key) => {
        records.delete(key);
      }),
    };
    const storage = new SecureMobileSessionStorage(driver);

    await storage.setItem("auth-session", "opaque-session-package");
    await expect(storage.getItem("auth-session")).resolves.toBe("opaque-session-package");
    expect(driver.setItem).toHaveBeenCalledWith("rhsia.mobile.auth-session.a.0", "opaque-session-package");
    expect(driver.setItem).toHaveBeenCalledWith(
      "rhsia.mobile.auth-session.manifest",
      JSON.stringify({ slot: "a", count: 1 }),
    );
    await storage.removeItem("auth-session");
    await expect(storage.getItem("auth-session")).resolves.toBeNull();
  });

  it("round-trips session credentials larger than one native secure-storage entry", async () => {
    const records = new Map<string, string>();
    const driver: SecureStorageDriver = {
      getItem: async (key) => records.get(key) ?? null,
      setItem: async (key, value) => {
        records.set(key, value);
      },
      removeItem: async (key) => {
        records.delete(key);
      },
    };
    const storage = new SecureMobileSessionStorage(driver);
    const largeSession = "x".repeat(5_000);

    await storage.setItem("auth-session", largeSession);
    await expect(storage.getItem("auth-session")).resolves.toBe(largeSession);
    expect(records.get("rhsia.mobile.auth-session.manifest")).toBe(JSON.stringify({ slot: "a", count: 3 }));
  });

  it("rejects storage keys outside the bounded native key namespace", async () => {
    const driver: SecureStorageDriver = {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn(),
    };
    const storage = new SecureMobileSessionStorage(driver);

    await expect(storage.setItem("../unexpected key", "value")).rejects.toThrow("Session storage key is invalid.");
    expect(driver.setItem).not.toHaveBeenCalled();
  });
});
