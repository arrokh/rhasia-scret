import { config as loadEnvironment } from "dotenv";
import { resolve } from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

loadEnvironment({ path: resolve(process.cwd(), "../../.env") });

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
const posthogAssetsHost = posthogHost?.replace(/:\/\/([a-z0-9-]+)\.i\./, "://$1-assets.i.");

const staticContentSecurityPolicy = [
  "default-src 'self'",
  ["script-src 'self' 'wasm-unsafe-eval'", posthogAssetsHost].filter(Boolean).join(" "),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  ["connect-src 'self' https://*.supabase.co wss://*.supabase.co", posthogHost].filter(Boolean).join(" "),
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

const securityHeaders = [
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  { key: "Content-Security-Policy", value: staticContentSecurityPolicy }
];

const nextDistDir = process.env.NEXT_DIST_DIR?.trim() || ".next";

const nextConfig: NextConfig = {
  distDir: nextDistDir,
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  allowedDevOrigins: [
    "127.0.0.1",
    "rhasia-scret.vercel.app",
  ],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/api/:path*", headers: [...securityHeaders, { key: "Cache-Control", value: "no-store, private" }] },
      { source: "/auth/:path*", headers: [...securityHeaders, { key: "Cache-Control", value: "no-store, private" }] }
    ];
  }
};

export default withNextIntl(nextConfig);
