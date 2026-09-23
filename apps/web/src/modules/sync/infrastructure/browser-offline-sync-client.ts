"use client";

import { browserAuthenticatedTransport } from "@/shared/infrastructure/browser-api-client";
import {
  AuthorizedWorkspaceTransport,
  type AuthorizedWorkspaceResponse,
  type CancellationPort,
} from "@rhasia-scret/client-vault-core";

const workspaceBundles = new AuthorizedWorkspaceTransport(browserAuthenticatedTransport);

export async function fetchAuthorizedWorkspaceBundle(signal?: CancellationPort): Promise<AuthorizedWorkspaceResponse> {
  return workspaceBundles.fetch(signal);
}
