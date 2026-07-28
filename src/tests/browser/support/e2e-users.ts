export const E2E_BROWSER_SCENARIOS = ["auth", "personal", "accounts", "shared", "passkey", "english"] as const;
export const E2E_BROWSER_ROLES = ["owner", "viewer-leave", "viewer-revoke"] as const;
export const E2E_BROWSER_ENGINES = ["chromium", "firefox", "webkit"] as const;

export function e2eUserAlias(browserName: string, scenario: typeof E2E_BROWSER_SCENARIOS[number], role: typeof E2E_BROWSER_ROLES[number] = "owner"): string {
  return `e2e-${browserName}-${scenario}-${role}`;
}

export function e2eUserEmail(alias: string): string {
  return `${alias}@browser-e2e.test`;
}

export function configuredE2eBrowserUsers(): Record<string, { subject: string; email: string }> {
  return Object.fromEntries(E2E_BROWSER_ENGINES.flatMap((browserName) =>
    E2E_BROWSER_SCENARIOS.flatMap((scenario) => E2E_BROWSER_ROLES.map((role) => {
      const alias = e2eUserAlias(browserName, scenario, role);
      return [alias, { subject: `subject:${alias}`, email: e2eUserEmail(alias) }];
    }))
  ));
}
