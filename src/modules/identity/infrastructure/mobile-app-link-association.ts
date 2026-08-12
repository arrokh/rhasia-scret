const iosBundleIdentifier = "com.arrokh.rhasiascret";
const androidPackageName = "com.arrokh.rhasiascret";
const approvedPaths = ["/auth/mobile", "/vaults/invitations/redeem"] as const;

export function appleAppSiteAssociation(env: Readonly<Record<string, string | undefined>> = process.env) {
  const teamId = env.MOBILE_APPLE_TEAM_ID?.trim();
  if (!teamId || !/^[A-Z0-9]{10}$/.test(teamId)) return null;
  return {
    applinks: {
      details: [{
        appIDs: [`${teamId}.${iosBundleIdentifier}`],
        components: approvedPaths.map((path) => ({ "/": path })),
      }],
    },
  };
}

export function androidAssetLinks(env: Readonly<Record<string, string | undefined>> = process.env) {
  const fingerprints = env.MOBILE_ANDROID_CERT_SHA256?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  if (fingerprints.length === 0 || fingerprints.some((value) => !/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(value))) return null;
  return [{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: androidPackageName,
      sha256_cert_fingerprints: fingerprints,
    },
  }];
}
