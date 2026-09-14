import { act, renderHook, waitFor } from "@testing-library/react-native";
import { AppState, Linking } from "react-native";
import type { AuthenticatedTransport } from "@rhasia-scret/client-vault-core";
import {
  withTimeout,
  type MobilePasswordlessAuthClient,
  type NativeMobileSession,
} from "../infrastructure/mobile-passwordless-auth-client";
import type { MobilePasswordlessAuthPort } from "../application/incoming-link";
import { useMobileSession } from "./use-mobile-session";

jest.mock("../application/load-mobile-application-user", () => ({
  loadMobileApplicationUser: jest.fn().mockResolvedValue({ status: "active" }),
}));

describe("withTimeout", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("rejects a stalled native request", async () => {
    jest.useFakeTimers();
    const request = withTimeout(new Promise<never>(() => undefined), 15_000);
    jest.advanceTimersByTime(15_000);
    await expect(request).rejects.toThrow("timed out");
  });

  it("clears its timer when the request settles", async () => {
    jest.useFakeTimers();
    const request = withTimeout(Promise.resolve("ok"), 15_000);
    await expect(request).resolves.toBe("ok");
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe("useMobileSession", () => {
  afterEach(() => jest.restoreAllMocks());

  const webOrigin = "https://vault.example.test";
  const token = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK";
  const initialUrl = `${webOrigin}/auth/mobile#token=${token}`;

  it("does not let a slow initial session read overwrite a magic-link session", async () => {
    const initialSession = deferred<NativeMobileSession | null>();
    const authenticatedSession: NativeMobileSession = {
      accessExpiresAt: Date.now() + 900_000,
      refreshExpiresAt: Date.now() + 2_592_000_000,
      user: { email: "person@example.test" },
    };
    const getSession = jest
      .fn<Promise<NativeMobileSession | null>, []>()
      .mockReturnValueOnce(initialSession.promise)
      .mockResolvedValueOnce(authenticatedSession);
    const redeemMagicLink = jest.fn<Promise<unknown>, [string]>().mockResolvedValue({});
    const auth = {
      getSession,
      redeemMagicLink,
      requestMagicLink: jest.fn(),
      refreshIfNeeded: jest.fn(),
      signOut: jest.fn(),
    } as unknown as MobilePasswordlessAuthClient & MobilePasswordlessAuthPort;
    const linkingSubscription = { remove: jest.fn() } as unknown as ReturnType<typeof Linking.addEventListener>;
    const appStateSubscription = { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    jest.spyOn(Linking, "addEventListener").mockImplementation(() => linkingSubscription);
    jest.spyOn(Linking, "getInitialURL").mockResolvedValue(initialUrl);
    jest.spyOn(AppState, "addEventListener").mockImplementation(() => appStateSubscription);

    const { result } = await renderHook(() => useMobileSession(auth, webOrigin, {} as AuthenticatedTransport));

    await waitFor(() => expect(redeemMagicLink).toHaveBeenCalledWith(token));
    await waitFor(() => expect(result.current.session).toEqual(authenticatedSession));

    await act(async () => {
      initialSession.resolve(null);
      await initialSession.promise;
    });

    expect(result.current.session).toEqual(authenticatedSession);
  });

  it("clears a pending Secure Share Link secret on sign-out", async () => {
    const secret = "client-only-secure-share-secret";
    const getSession = jest.fn<Promise<NativeMobileSession | null>, []>().mockResolvedValue(null);
    const auth = {
      getSession,
      redeemMagicLink: jest.fn(),
      requestMagicLink: jest.fn(),
      refreshIfNeeded: jest.fn(),
      signOut: jest.fn().mockResolvedValue(undefined),
    } as unknown as MobilePasswordlessAuthClient & MobilePasswordlessAuthPort;
    const linkingSubscription = { remove: jest.fn() } as unknown as ReturnType<typeof Linking.addEventListener>;
    const appStateSubscription = { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    jest.spyOn(Linking, "addEventListener").mockImplementation(() => linkingSubscription);
    jest.spyOn(Linking, "getInitialURL").mockResolvedValue(`${webOrigin}/vaults/invitations/redeem#${secret}`);
    jest.spyOn(AppState, "addEventListener").mockImplementation(() => appStateSubscription);

    const { result } = await renderHook(() => useMobileSession(auth, webOrigin, {} as AuthenticatedTransport));

    await waitFor(() => expect(result.current.status).toBe("share_link_ready"));
    await act(async () => {
      await result.current.signOut();
    });

    expect(result.current.consumeSecureShareSecret()).toBeNull();
  });
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
