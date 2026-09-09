import { SecureSupabaseSessionStorage, type SecureStorageDriver } from "./secure-session-storage";

describe("SecureSupabaseSessionStorage", () => {
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
    const storage = new SecureSupabaseSessionStorage(driver);

    await storage.setItem("sb-project-auth-token", "opaque-session-package");
    await expect(storage.getItem("sb-project-auth-token")).resolves.toBe("opaque-session-package");
    expect(driver.setItem).toHaveBeenCalledWith("rhsia.mobile.sb-project-auth-token.a.0", "opaque-session-package");
    expect(driver.setItem).toHaveBeenCalledWith(
      "rhsia.mobile.sb-project-auth-token.manifest",
      JSON.stringify({ slot: "a", count: 1 }),
    );
    await storage.removeItem("sb-project-auth-token");
    await expect(storage.getItem("sb-project-auth-token")).resolves.toBeNull();
  });

  it("round-trips provider sessions larger than one native secure-storage entry", async () => {
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
    const storage = new SecureSupabaseSessionStorage(driver);
    const largeSession = "x".repeat(5_000);

    await storage.setItem("sb-project-auth-token", largeSession);
    await expect(storage.getItem("sb-project-auth-token")).resolves.toBe(largeSession);
    expect(records.get("rhsia.mobile.sb-project-auth-token.manifest")).toBe(JSON.stringify({ slot: "a", count: 3 }));
  });

  it("rejects storage keys outside the bounded native key namespace", async () => {
    const driver: SecureStorageDriver = {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn(),
    };
    const storage = new SecureSupabaseSessionStorage(driver);

    await expect(storage.setItem("../unexpected key", "value")).rejects.toThrow("Session storage key is invalid.");
    expect(driver.setItem).not.toHaveBeenCalled();
  });
});
