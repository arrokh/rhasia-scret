import type { ApplicationUserRepository, ApplicationUserStatus, SessionVerifier } from "@/modules/identity";
import type { VaultLifecycle } from "../domain/vault";
import type { PersonalVaultRepository } from "./personal-vault-repository";

export type VaultPageContext = {
  user: {
    id: string;
    email: string;
    status: ApplicationUserStatus;
  };
  personalVault: {
    id: string;
    lifecycle: VaultLifecycle;
  };
};

export type ExistingVaultPageContext = Omit<VaultPageContext, "personalVault"> & {
  personalVault: VaultPageContext["personalVault"] | null;
};

export interface VaultPageContextReader {
  findBySessionSubject(subject: string): Promise<ExistingVaultPageContext | null>;
}

export async function resolveVaultPageContext(
  sessionVerifier: SessionVerifier,
  applicationUsers: ApplicationUserRepository,
  personalVaults: PersonalVaultRepository,
  contexts: VaultPageContextReader
): Promise<VaultPageContext | null> {
  const session = await sessionVerifier.verify();
  if (!session) return null;

  const existing = await contexts.findBySessionSubject(session.subject);
  if (existing?.personalVault && existing.user.email === session.email) return existing as VaultPageContext;

  const user = await applicationUsers.provision(session);
  if (existing?.personalVault) {
    return {
      user: { id: user.id, email: user.email, status: user.status },
      personalVault: existing.personalVault
    };
  }

  const personalVault = await personalVaults.ensureForOwner(user.id);
  return {
    user: { id: user.id, email: user.email, status: user.status },
    personalVault: { id: personalVault.id, lifecycle: personalVault.lifecycle }
  };
}
