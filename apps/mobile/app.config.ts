import type { ConfigContext, ExpoConfig } from "expo/config";

const configuredWebOrigin = process.env.EXPO_PUBLIC_WEB_ORIGIN?.trim();
const productionHost = configuredWebOrigin ? configuredWebHostname(configuredWebOrigin) : undefined;

const mobileAppConfig = ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "rhasia-scret",
  slug: "rhasia-scret",
  scheme: "rhasia-scret",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  plugins: [
    "expo-localization",
    "expo-secure-store",
    "expo-sharing",
    [
      "expo-camera",
      {
        cameraPermission:
          "Izinkan rhasia-scret memindai kode QR Authenticator / Allow rhasia-scret to scan Authenticator QR codes",
        barcodeScannerEnabled: true,
        recordAudioAndroid: false,
      },
    ],
  ],
  ios: {
    bundleIdentifier: "com.arrokh.rhasiascret",
    supportsTablet: true,
    associatedDomains: productionHost ? [`applinks:${productionHost}`] : [],
    infoPlist: {
      CFBundleAllowMixedLocalizations: true,
      CFBundleLocalizations: ["id", "en"],
    },
  },
  android: {
    package: "com.arrokh.rhasiascret",
    adaptiveIcon: {
      backgroundColor: "#F9F6F0",
      foregroundImage: "./assets/android-icon-foreground.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    intentFilters: productionHost
      ? [
          {
            action: "VIEW",
            autoVerify: true,
            category: ["BROWSABLE", "DEFAULT"],
            data: [
              { scheme: "https", host: productionHost, pathPrefix: "/auth/mobile" },
              { scheme: "https", host: productionHost, pathPrefix: "/vaults/invitations/redeem" },
            ],
          },
        ]
      : [],
  },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
    webOrigin: process.env.EXPO_PUBLIC_WEB_ORIGIN,
    authRedirectUrl: process.env.EXPO_PUBLIC_AUTH_REDIRECT_URL,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    nativeCryptoValidation: process.env.EXPO_PUBLIC_NATIVE_CRYPTO_VALIDATION === "1",
  },
});

export default mobileAppConfig;

function configuredWebHostname(origin: string): string {
  const parsed = new URL(origin);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("EXPO_PUBLIC_WEB_ORIGIN must be an HTTPS origin without credentials, a path, query, or fragment.");
  }
  return parsed.hostname;
}
