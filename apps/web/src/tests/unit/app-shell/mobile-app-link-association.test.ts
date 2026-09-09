import { describe, expect, it } from "vitest";
import {
  androidAssetLinks,
  appleAppSiteAssociation,
} from "@/modules/identity/infrastructure/mobile-app-link-association";

const fingerprint = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, "0").toUpperCase()).join(
  ":",
);

describe("mobile app-link association", () => {
  it("publishes only the authentication and Secure Share Link paths for the signed iOS app", () => {
    expect(appleAppSiteAssociation({ MOBILE_APPLE_TEAM_ID: "A1B2C3D4E5" })).toEqual({
      applinks: {
        details: [
          {
            appIDs: ["A1B2C3D4E5.com.arrokh.rhasiascret"],
            components: [{ "/": "/auth/mobile" }, { "/": "/vaults/invitations/redeem" }],
          },
        ],
      },
    });
  });

  it("publishes every approved Android signing certificate without a wildcard path contract", () => {
    expect(androidAssetLinks({ MOBILE_ANDROID_CERT_SHA256: `${fingerprint},${fingerprint}` })).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "com.arrokh.rhasiascret",
          sha256_cert_fingerprints: [fingerprint, fingerprint],
        },
      },
    ]);
  });

  it("fails closed when signing identity is missing or malformed", () => {
    expect(appleAppSiteAssociation({})).toBeNull();
    expect(appleAppSiteAssociation({ MOBILE_APPLE_TEAM_ID: "placeholder" })).toBeNull();
    expect(androidAssetLinks({})).toBeNull();
    expect(androidAssetLinks({ MOBILE_ANDROID_CERT_SHA256: "not-a-fingerprint" })).toBeNull();
  });
});
