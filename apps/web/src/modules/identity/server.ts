import type { ApplicationUserRepository } from "./application/application-user-repository";
import { loadApplicationUser } from "./application/load-application-user";
import type { SessionAssurance, SessionVerifier } from "./application/session-verifier";
import type { SessionTerminator } from "./application/session-terminator";
import type { UserCryptoProfileRepository } from "./application/user-crypto-profile-repository";
import { readAuthConfiguration, type AuthBackend } from "./infrastructure/auth-backend";
import { NoneSessionVerifier } from "./infrastructure/none-session-verifier";
import { OidcSessionVerifier } from "./infrastructure/oidc-session-verifier";
import { OidcSessionTerminator } from "./infrastructure/oidc-session-terminator";
import { PrismaApplicationUserRepository } from "./infrastructure/prisma-application-user-repository";
import { PrismaPasskeyRecoveryRepository } from "./infrastructure/prisma-passkey-recovery-repository";
import { PrismaUserCryptoProfileRepository } from "./infrastructure/prisma-user-crypto-profile-repository";
import { isOidcPrincipalAdmitted } from "./infrastructure/prisma-application-admission";
import { completeSupabaseCallback as completeSupabaseCallbackWithAdapter, readSupabaseCallbackConfiguration, type SupabaseCallbackCookieStore } from "./infrastructure/supabase-auth-callback";
import { SupabaseSessionTerminator } from "./infrastructure/supabase-session-terminator";
import { SupabaseSessionVerifier } from "./infrastructure/supabase-session-verifier";

export { loadApplicationUser };
export type { ApplicationUserRepository, SessionVerifier, UserCryptoProfileRepository };
export { browserE2eAuthenticationVerified, browserE2eRegistrationCredential } from "./infrastructure/browser-e2e-passkey-verification";
export { passkeyRecoveryConfiguration } from "./infrastructure/passkey-recovery-configuration";

export type SupabaseCallbackResult = "success" | "configuration_error" | "verification_failed";

export async function completeSupabaseCallback(code: string | null, tokenHash: string | null, cookieStore: SupabaseCallbackCookieStore): Promise<SupabaseCallbackResult> {
  try {
    const configuration = readAuthConfiguration();
    const supabase = readSupabaseCallbackConfiguration();
    if (configuration.backend !== "supabase" || !supabase) return "configuration_error";
    return await completeSupabaseCallbackWithAdapter(code, tokenHash, cookieStore, supabase) ? "success" : "verification_failed";
  } catch {
    return "verification_failed";
  }
}

export function authBackend(): AuthBackend {
  try {
    return readAuthConfiguration().backend;
  } catch {
    return "none";
  }
}

export function createSessionVerifier(minimumAssurance: SessionAssurance = "fresh-provider-user"): SessionVerifier {
  try {
    const configuration = readAuthConfiguration();
    if (configuration.backend === "none") return new NoneSessionVerifier();
    if (configuration.backend === "oidc") return new OidcSessionVerifier(configuration.oidc);
    return new SupabaseSessionVerifier(minimumAssurance === "verified-claims" ? "claims" : "fresh-user");
  } catch {
    return new NoneSessionVerifier();
  }
}

export function createSessionTerminator(): SessionTerminator {
  try {
    const configuration = readAuthConfiguration();
    return configuration.backend === "oidc" ? new OidcSessionTerminator() : new SupabaseSessionTerminator();
  } catch {
    return new OidcSessionTerminator();
  }
}

export function createPasskeyRecoveryRepository(): PrismaPasskeyRecoveryRepository {
  return new PrismaPasskeyRecoveryRepository();
}

export function createUserCryptoProfileRepository(): UserCryptoProfileRepository {
  return new PrismaUserCryptoProfileRepository();
}

export function createApplicationUserRepository(): PrismaApplicationUserRepository {
  try {
    const configuration = readAuthConfiguration();
    return new PrismaApplicationUserRepository(configuration.backend === "oidc" ? isOidcPrincipalAdmitted : async () => configuration.backend !== "none");
  } catch {
    return new PrismaApplicationUserRepository(async () => false);
  }
}
