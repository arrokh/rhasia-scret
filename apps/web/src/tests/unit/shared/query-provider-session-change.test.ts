/** @vitest-environment jsdom */

import { act, createElement, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestVaultSessionChange } from "@/modules/sync";
import { clearPendingSecureShareLinkAuthentication } from "@/modules/vault-membership";
import { InvitationAuthContinuation } from "@/modules/identity/presentation/invitation-auth-continuation";
import { announceAuthenticationCompletion } from "@/modules/identity/presentation/auth-completion-channel";
import { QueryProvider } from "@/shared/presentation/query-provider";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type MessageListener = (event: MessageEvent<unknown>) => void;
const channels = new Set<FakeBroadcastChannel>();

class FakeBroadcastChannel {
  private readonly listeners = new Set<MessageListener>();

  public constructor(private readonly name: string) {
    channels.add(this);
  }

  public addEventListener(type: string, listener: MessageListener): void {
    if (type === "message") this.listeners.add(listener);
  }

  public removeEventListener(type: string, listener: MessageListener): void {
    if (type === "message") this.listeners.delete(listener);
  }

  public postMessage(data: unknown): void {
    for (const channel of channels) {
      if (channel === this || channel.name !== this.name) continue;
      for (const listener of channel.listeners) listener(new MessageEvent("message", { data }));
    }
  }

  public close(): void {
    channels.delete(this);
  }
}

let root: Root | undefined;
let queryClient: QueryClient | undefined;
let startSessionChangeMutation: (() => Promise<string>) | undefined;
let seededPrivateMetadata = false;
let resolveLateQuery: ((value: string) => void) | undefined;
let observedLateQueryData: string | undefined;
let resolveFreshAccountQuery: ((value: string) => void) | undefined;
let observedResolvedAccountData: string | undefined;
let resolveLateMutation: ((value: string) => void) | undefined;
let startLateMutation: (() => Promise<string>) | undefined;
const lateQueryKey = ["vault-membership", "synthetic-account-switch"] as const;
const resolvedAccountQueryKey = ["vault-membership", "resolved-account-metadata"] as const;
const lateMutationKey = ["vault-membership", "late-mutation-result"] as const;
const container = document.createElement("div");

function ObserveResolvedAccountQuery() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: resolvedAccountQueryKey,
    queryFn: () =>
      new Promise<string>((resolve) => {
        resolveFreshAccountQuery = resolve;
      }),
  });
  useEffect(() => {
    queryClient = client;
  }, [client]);
  useEffect(() => {
    observedResolvedAccountData = query.data;
  }, [query.data]);
  return createElement("output", { "data-testid": "account-query-data" }, query.data ?? "empty");
}

function ObserveLateAccountQuery() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: lateQueryKey,
    queryFn: () =>
      new Promise<string>((resolve) => {
        resolveLateQuery = resolve;
      }),
  });
  useEffect(() => {
    queryClient = client;
  }, [client]);
  useEffect(() => {
    observedLateQueryData = query.data;
  }, [query.data]);
  return null;
}

function ObserveLateMutation() {
  const client = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationFn: () =>
      new Promise<string>((resolve) => {
        resolveLateMutation = resolve;
      }),
    onSuccess: (data) => client.setQueryData(lateMutationKey, data),
  });
  useEffect(() => {
    queryClient = client;
    startLateMutation = () => mutateAsync();
    return () => {
      startLateMutation = undefined;
    };
  }, [client, mutateAsync]);
  return null;
}

function SeedPrivateMetadataQuery() {
  const client = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationFn: async () => {
      requestVaultSessionChange();
      return "synthetic-session-ended";
    },
  });
  useEffect(() => {
    queryClient = client;
    startSessionChangeMutation = () => mutateAsync();
    if (!seededPrivateMetadata) {
      seededPrivateMetadata = true;
      client.setQueryData(["vault-membership", "shared-vault", "synthetic-vault", "participants"], {
        participants: [{ email: "synthetic-member@example.test" }],
      });
    }
    return () => {
      startSessionChangeMutation = undefined;
    };
  }, [client, mutateAsync]);
  return null;
}

beforeEach(() => {
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  queryClient = undefined;
  startSessionChangeMutation = undefined;
  seededPrivateMetadata = false;
  resolveLateQuery = undefined;
  observedLateQueryData = undefined;
  resolveFreshAccountQuery = undefined;
  observedResolvedAccountData = undefined;
  resolveLateMutation = undefined;
  startLateMutation = undefined;
  container.innerHTML = "";
  window.history.replaceState(null, "", "/");
  clearPendingSecureShareLinkAuthentication();
  vi.unstubAllGlobals();
});

describe("QueryProvider authentication session changes", () => {
  it("keeps the real invitation completion listener through session-query replacement", async () => {
    const secret = "synthetic-secure-share-link-secret-00000000";
    window.history.replaceState(null, "", `/sign-in?next=%2Fvaults%2Finvitations%2Fredeem#${secret}`);
    const navigate = vi.fn();
    const mounted = vi.fn();
    const unmounted = vi.fn();

    function SignInListener() {
      const client = useQueryClient();
      useEffect(() => {
        queryClient = client;
      }, [client]);
      useEffect(() => {
        mounted();
        return unmounted;
      }, []);
      return createElement(InvitationAuthContinuation, {
        nextPath: "/vaults/invitations/redeem",
        navigate,
      });
    }

    await act(async () => {
      root = createRoot(container);
      root.render(createElement(QueryProvider, null, createElement(SignInListener)));
    });

    const firstClient = queryClient;
    if (!firstClient) throw new Error("QueryProvider did not expose its test client.");
    firstClient.setQueryData(lateQueryKey, "synthetic-sign-in-state");

    await act(async () => {
      requestVaultSessionChange();
    });

    expect(queryClient).toBeDefined();
    expect(queryClient).not.toBe(firstClient);
    expect(firstClient.getQueryData(lateQueryKey)).toBeUndefined();
    expect(queryClient?.getQueryData(lateQueryKey)).toBeUndefined();
    expect(mounted).toHaveBeenCalledOnce();
    expect(unmounted).not.toHaveBeenCalled();

    await act(async () => announceAuthenticationCompletion());

    expect(navigate).toHaveBeenCalledWith(expect.stringContaining(`/vaults/invitations/redeem#${secret}`));
  });

  it("remounts an observer holding resolved account metadata on session change", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(QueryProvider, null, createElement(ObserveResolvedAccountQuery)));
    });

    const client = queryClient;
    if (!client) throw new Error("QueryProvider did not expose its test client.");
    const resolveInitialAccountQuery = resolveFreshAccountQuery;
    if (!resolveInitialAccountQuery) throw new Error("The account query did not start.");
    await act(async () => {
      resolveInitialAccountQuery("synthetic-old-account-metadata");
      await vi.waitFor(() =>
        expect(client.getQueryData(resolvedAccountQueryKey)).toBe("synthetic-old-account-metadata"),
      );
    });
    expect(container.textContent).toContain("synthetic-old-account-metadata");
    expect(observedResolvedAccountData).toBe("synthetic-old-account-metadata");

    await act(async () => {
      requestVaultSessionChange();
    });

    expect(container.textContent).toContain("empty");
    expect(container.textContent).not.toContain("synthetic-old-account-metadata");
    expect(observedResolvedAccountData).toBeUndefined();
    const nextClient = queryClient;
    expect(nextClient).toBeDefined();
    expect(nextClient).not.toBe(client);
    expect(client.getQueryData(resolvedAccountQueryKey)).toBeUndefined();
    expect(nextClient?.getQueryData(resolvedAccountQueryKey)).toBeUndefined();
  });

  it("discards a late response from an observed query that ignores cancellation on session change", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        createElement(
          QueryProvider,
          null,
          createElement(SeedPrivateMetadataQuery),
          createElement(ObserveLateAccountQuery),
        ),
      );
      await Promise.resolve();
    });

    const client = queryClient;
    if (!client) throw new Error("QueryProvider did not expose its test client.");
    expect(resolveLateQuery).toBeDefined();
    expect(client.getQueryCache().find({ queryKey: lateQueryKey })).toBeDefined();
    const resolveStaleResponse = resolveLateQuery;
    if (!resolveStaleResponse) throw new Error("The in-flight account query did not start.");

    await act(async () => {
      requestVaultSessionChange();
    });

    const nextClient = queryClient;
    expect(nextClient).toBeDefined();
    expect(nextClient).not.toBe(client);
    expect(nextClient?.getQueryCache().find({ queryKey: lateQueryKey })).toBeDefined();
    await act(async () => {
      resolveStaleResponse("synthetic-stale-account-response");
      await Promise.resolve();
    });

    expect(queryClient).toBe(nextClient);
    expect(client.getQueryCache().find({ queryKey: lateQueryKey })).toBeUndefined();
    expect(nextClient?.getQueryCache().find({ queryKey: lateQueryKey })).toBeDefined();
    expect(nextClient?.getQueryData(lateQueryKey)).toBeUndefined();
    expect(observedLateQueryData).toBeUndefined();
  });

  it("handles repeated session changes in one tick under StrictMode", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        createElement(StrictMode, null, createElement(QueryProvider, null, createElement(SeedPrivateMetadataQuery))),
      );
    });
    const initialClient = queryClient;
    if (!initialClient) throw new Error("QueryProvider did not expose its test client.");

    await act(async () => {
      requestVaultSessionChange();
      requestVaultSessionChange();
    });

    expect(queryClient).toBeDefined();
    expect(queryClient).not.toBe(initialClient);
    expect(initialClient.getQueryCache().getAll()).toHaveLength(0);
    expect(queryClient?.getQueryCache().getAll()).toHaveLength(0);
  });

  it("keeps late mutation callbacks out of the replacement account cache", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(QueryProvider, null, createElement(ObserveLateMutation)));
    });

    const oldClient = queryClient;
    if (!oldClient) throw new Error("QueryProvider did not expose its test client.");
    let pendingMutation: Promise<string> | undefined;
    await act(async () => {
      pendingMutation = startLateMutation?.();
      await Promise.resolve();
    });
    if (!pendingMutation) throw new Error("The test mutation did not start.");
    const resolveStaleMutation = resolveLateMutation;
    if (!resolveStaleMutation) throw new Error("The test mutation did not expose its resolver.");

    await act(async () => {
      requestVaultSessionChange();
    });
    const newClient = queryClient;
    expect(newClient).toBeDefined();
    expect(newClient).not.toBe(oldClient);

    await act(async () => {
      resolveStaleMutation("synthetic-old-account-mutation-result");
      await expect(pendingMutation).resolves.toBe("synthetic-old-account-mutation-result");
    });

    expect(oldClient.getQueryData(lateMutationKey)).toBe("synthetic-old-account-mutation-result");
    expect(newClient?.getQueryData(lateMutationKey)).toBeUndefined();
  });

  it("clears account-scoped state on local and cross-tab changes without a service-worker subscriber", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(QueryProvider, null, createElement(SeedPrivateMetadataQuery)));
    });

    expect(queryClient?.getQueryCache().getAll()).toHaveLength(1);
    expect(queryClient?.getQueryData(["vault-membership", "shared-vault", "synthetic-vault", "participants"])).toEqual({
      participants: [{ email: "synthetic-member@example.test" }],
    });

    const firstClient = queryClient;
    if (!firstClient) throw new Error("QueryProvider did not expose its test client.");
    let mutationResult: string | undefined;
    await act(async () => {
      mutationResult = await startSessionChangeMutation?.();
    });

    expect(mutationResult).toBe("synthetic-session-ended");
    const secondClient = queryClient;
    expect(secondClient).toBeDefined();
    expect(secondClient).not.toBe(firstClient);
    expect(firstClient.getQueryCache().getAll()).toHaveLength(0);
    expect(secondClient?.getQueryCache().getAll()).toHaveLength(0);
    expect(firstClient.getMutationCache().getAll()).toHaveLength(0);
    expect(secondClient?.getMutationCache().getAll()).toHaveLength(0);

    secondClient?.setQueryData(["vault-membership", "shared-vault", "synthetic-vault", "participants"], {
      participants: [{ email: "synthetic-member@example.test" }],
    });
    expect(secondClient?.getQueryCache().getAll()).toHaveLength(1);
    const otherTab = new FakeBroadcastChannel("rhasia-scret:vault-session-change");
    await act(async () => {
      otherTab.postMessage({ type: "session-changed", changeId: "synthetic-change-id-1" });
    });
    const thirdClient = queryClient;
    expect(thirdClient).toBeDefined();
    expect(thirdClient).not.toBe(secondClient);
    expect(secondClient?.getQueryCache().getAll()).toHaveLength(0);
    expect(thirdClient?.getQueryCache().getAll()).toHaveLength(0);
    otherTab.close();
  });
});
