import { MobilePasswordlessAuthClient, type NativeMobileSession } from "./mobile-passwordless-auth-client";
import { SecureMobileSessionStorage, type SecureStorageDriver } from "./secure-session-storage";

const accessToken = `0123456789abcdef.${"a".repeat(43)}`;
const refreshToken = `0123456789abcdef.${"b".repeat(43)}`;
const configuration = {
  apiUrl: "https://vault.example.test",
  webOrigin: "https://vault.example.test",
  authRedirectUrl: "https://vault.example.test/auth/mobile",
};

describe("MobilePasswordlessAuthClient", () => {
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
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    records.clear();
    fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("keeps credentials in secure storage and exposes only session metadata", async () => {
    const client = new MobilePasswordlessAuthClient(configuration, new SecureMobileSessionStorage(driver));
    fetchMock.mockResolvedValue(
      jsonResponse({
        accessToken,
        refreshToken,
        accessExpiresAt: new Date(Date.now() + 900_000).toISOString(),
        refreshExpiresAt: new Date(Date.now() + 2_592_000_000).toISOString(),
        email: "person@example.test",
      }),
    );

    const session = await client.redeemMagicLink("a".repeat(43));
    const stored = await client.getSession();

    expect(session).toEqual<NativeMobileSession>({
      accessExpiresAt: expect.any(Number),
      refreshExpiresAt: expect.any(Number),
      user: { email: "person@example.test" },
    });
    expect(session).not.toHaveProperty("accessToken");
    expect(session).not.toHaveProperty("refreshToken");
    expect(stored).toEqual(session);
    await expect(new SecureMobileSessionStorage(driver).getItem("auth-session")).resolves.toContain(accessToken);
    await expect(new SecureMobileSessionStorage(driver).getItem("auth-session")).resolves.toContain(refreshToken);
  });

  it("refreshes through the adapter without returning the rotated credentials", async () => {
    const client = new MobilePasswordlessAuthClient(configuration, new SecureMobileSessionStorage(driver));
    const rotatedAccessToken = `0123456789abcdef.${"c".repeat(43)}`;
    const rotatedRefreshToken = `0123456789abcdef.${"d".repeat(43)}`;
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          accessToken,
          refreshToken,
          accessExpiresAt: new Date(Date.now() + 30_000).toISOString(),
          refreshExpiresAt: new Date(Date.now() + 2_592_000_000).toISOString(),
          email: "person@example.test",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          accessToken: rotatedAccessToken,
          refreshToken: rotatedRefreshToken,
          accessExpiresAt: new Date(Date.now() + 900_000).toISOString(),
          refreshExpiresAt: new Date(Date.now() + 2_592_000_000).toISOString(),
          email: "person@example.test",
        }),
      );

    await client.redeemMagicLink("a".repeat(43));
    await expect(client.getAccessToken()).resolves.toBe(rotatedAccessToken);
    const session = await client.getSession();
    expect(session).not.toHaveProperty("accessToken");
    expect(session).not.toHaveProperty("refreshToken");
    expect(fetchMock).toHaveBeenLastCalledWith(
      new URL("/v1/auth/session/refresh", configuration.apiUrl),
      expect.objectContaining({
        body: JSON.stringify({ client: "mobile", refreshToken }),
      }),
    );
  });

  it("shares an in-flight refresh so concurrent requests do not trigger reuse detection", async () => {
    const client = new MobilePasswordlessAuthClient(configuration, new SecureMobileSessionStorage(driver));
    let resolveRefresh!: (response: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          accessToken,
          refreshToken,
          accessExpiresAt: new Date(Date.now() + 30_000).toISOString(),
          refreshExpiresAt: new Date(Date.now() + 2_592_000_000).toISOString(),
          email: "person@example.test",
        }),
      )
      .mockReturnValueOnce(refreshResponse);

    await client.redeemMagicLink("a".repeat(43));
    const first = client.getAccessToken();
    const second = client.getAccessToken();
    resolveRefresh(
      jsonResponse({
        accessToken: `0123456789abcdef.${"c".repeat(43)}`,
        refreshToken: `0123456789abcdef.${"d".repeat(43)}`,
        accessExpiresAt: new Date(Date.now() + 900_000).toISOString(),
        refreshExpiresAt: new Date(Date.now() + 2_592_000_000).toISOString(),
        email: "person@example.test",
      }),
    );

    await expect(Promise.all([first, second])).resolves.toEqual([
      `0123456789abcdef.${"c".repeat(43)}`,
      `0123456789abcdef.${"c".repeat(43)}`,
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not let a stale refresh overwrite a newer magic-link session", async () => {
    const client = new MobilePasswordlessAuthClient(configuration, new SecureMobileSessionStorage(driver));
    const latestAccessToken = `0123456789abcdef.${"e".repeat(43)}`;
    const latestRefreshToken = `0123456789abcdef.${"f".repeat(43)}`;
    let resolveRefresh!: (response: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          accessToken,
          refreshToken,
          accessExpiresAt: new Date(Date.now() + 30_000).toISOString(),
          refreshExpiresAt: new Date(Date.now() + 2_592_000_000).toISOString(),
          email: "person@example.test",
        }),
      )
      .mockReturnValueOnce(refreshResponse)
      .mockResolvedValueOnce(
        jsonResponse({
          accessToken: latestAccessToken,
          refreshToken: latestRefreshToken,
          accessExpiresAt: new Date(Date.now() + 900_000).toISOString(),
          refreshExpiresAt: new Date(Date.now() + 2_592_000_000).toISOString(),
          email: "person@example.test",
        }),
      );

    await client.redeemMagicLink("a".repeat(43));
    const staleRefresh = client.getAccessToken();
    await waitForFetchCall(fetchMock, 2);
    await expect(client.redeemMagicLink("c".repeat(43))).resolves.toEqual({
      accessExpiresAt: expect.any(Number),
      refreshExpiresAt: expect.any(Number),
      user: { email: "person@example.test" },
    });
    resolveRefresh(
      jsonResponse({
        accessToken: `0123456789abcdef.${"g".repeat(43)}`,
        refreshToken: `0123456789abcdef.${"h".repeat(43)}`,
        accessExpiresAt: new Date(Date.now() + 900_000).toISOString(),
        refreshExpiresAt: new Date(Date.now() + 2_592_000_000).toISOString(),
        email: "person@example.test",
      }),
    );

    await expect(staleRefresh).resolves.toBe(latestAccessToken);
    await expect(client.getAccessToken()).resolves.toBe(latestAccessToken);
  });

  it("refreshes an expired access credential before remote revocation", async () => {
    const client = new MobilePasswordlessAuthClient(configuration, new SecureMobileSessionStorage(driver));
    const rotatedAccessToken = `0123456789abcdef.${"c".repeat(43)}`;
    const rotatedRefreshToken = `0123456789abcdef.${"d".repeat(43)}`;
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          accessToken,
          refreshToken,
          accessExpiresAt: new Date(Date.now() + 30_000).toISOString(),
          refreshExpiresAt: new Date(Date.now() + 2_592_000_000).toISOString(),
          email: "person@example.test",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          accessToken: rotatedAccessToken,
          refreshToken: rotatedRefreshToken,
          accessExpiresAt: new Date(Date.now() + 900_000).toISOString(),
          refreshExpiresAt: new Date(Date.now() + 2_592_000_000).toISOString(),
          email: "person@example.test",
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await client.redeemMagicLink("a".repeat(43));
    await client.signOut();

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      new URL("/v1/auth/session/refresh", configuration.apiUrl),
      expect.objectContaining({ body: JSON.stringify({ client: "mobile", refreshToken }) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      new URL("/v1/auth/session/revoke", configuration.apiUrl),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${rotatedAccessToken}` }),
      }),
    );
  });

  it("prevents a new magic-link session while sign-out is in progress", async () => {
    const client = new MobilePasswordlessAuthClient(configuration, new SecureMobileSessionStorage(driver));
    let resolveRevoke!: (response: Response) => void;
    const revokeResponse = new Promise<Response>((resolve) => {
      resolveRevoke = resolve;
    });
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          accessToken,
          refreshToken,
          accessExpiresAt: new Date(Date.now() + 900_000).toISOString(),
          refreshExpiresAt: new Date(Date.now() + 2_592_000_000).toISOString(),
          email: "person@example.test",
        }),
      )
      .mockReturnValueOnce(revokeResponse);

    await client.redeemMagicLink("a".repeat(43));
    const signOut = client.signOut();
    await waitForFetchCall(fetchMock, 2);
    await expect(client.redeemMagicLink("b".repeat(43))).rejects.toThrow("signing out");
    resolveRevoke(new Response(null, { status: 204 }));
    await expect(signOut).resolves.toBeUndefined();
    await expect(client.getSession()).resolves.toBeNull();
  });

  it("clears secure storage even when remote revocation fails", async () => {
    const client = new MobilePasswordlessAuthClient(configuration, new SecureMobileSessionStorage(driver));
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          accessToken,
          refreshToken,
          accessExpiresAt: new Date(Date.now() + 900_000).toISOString(),
          refreshExpiresAt: new Date(Date.now() + 2_592_000_000).toISOString(),
          email: "person@example.test",
        }),
      )
      .mockRejectedValueOnce(new Error("network unavailable"));

    await client.redeemMagicLink("a".repeat(43));
    await expect(client.signOut()).rejects.toThrow("network unavailable");
    await expect(client.getSession()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenLastCalledWith(
      new URL("/v1/auth/session/revoke", configuration.apiUrl),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${accessToken}` }) }),
    );
  });
});

async function waitForFetchCall(fetchMock: jest.MockedFunction<typeof fetch>, count: number): Promise<void> {
  for (let attempt = 0; attempt < 20 && fetchMock.mock.calls.length < count; attempt += 1)
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(fetchMock).toHaveBeenCalledTimes(count);
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}
