import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { QueryProvider } from "@/shared/presentation/query-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "rhasia-scret",
  description: "Autentikator TOTP terenkripsi untuk brankas pribadi dan bersama",
  applicationName: "rhasia-scret",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "rhasia-scret"
  },
  icons: {
    icon: [
      { url: "/pwa/android/launchericon-48x48.png", sizes: "48x48", type: "image/png" },
      { url: "/pwa/android/launchericon-96x96.png", sizes: "96x96", type: "image/png" },
      { url: "/pwa/android/launchericon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/pwa/icon512_rounded.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [
      { url: "/pwa/ios/16.png", sizes: "16x16", type: "image/png" },
      { url: "/pwa/ios/20.png", sizes: "20x20", type: "image/png" },
      { url: "/pwa/ios/29.png", sizes: "29x29", type: "image/png" },
      { url: "/pwa/ios/32.png", sizes: "32x32", type: "image/png" },
      { url: "/pwa/ios/40.png", sizes: "40x40", type: "image/png" },
      { url: "/pwa/ios/50.png", sizes: "50x50", type: "image/png" },
      { url: "/pwa/ios/57.png", sizes: "57x57", type: "image/png" },
      { url: "/pwa/ios/58.png", sizes: "58x58", type: "image/png" },
      { url: "/pwa/ios/60.png", sizes: "60x60", type: "image/png" },
      { url: "/pwa/ios/64.png", sizes: "64x64", type: "image/png" },
      { url: "/pwa/ios/72.png", sizes: "72x72", type: "image/png" },
      { url: "/pwa/ios/76.png", sizes: "76x76", type: "image/png" },
      { url: "/pwa/ios/80.png", sizes: "80x80", type: "image/png" },
      { url: "/pwa/ios/87.png", sizes: "87x87", type: "image/png" },
      { url: "/pwa/ios/100.png", sizes: "100x100", type: "image/png" },
      { url: "/pwa/ios/114.png", sizes: "114x114", type: "image/png" },
      { url: "/pwa/ios/120.png", sizes: "120x120", type: "image/png" },
      { url: "/pwa/ios/128.png", sizes: "128x128", type: "image/png" },
      { url: "/pwa/ios/144.png", sizes: "144x144", type: "image/png" },
      { url: "/pwa/ios/152.png", sizes: "152x152", type: "image/png" },
      { url: "/pwa/ios/167.png", sizes: "167x167", type: "image/png" },
      { url: "/pwa/ios/180.png", sizes: "180x180", type: "image/png" },
      { url: "/pwa/ios/192.png", sizes: "192x192", type: "image/png" },
      { url: "/pwa/ios/256.png", sizes: "256x256", type: "image/png" },
      { url: "/pwa/ios/512.png", sizes: "512x512", type: "image/png" },
      { url: "/pwa/ios/1024.png", sizes: "1024x1024", type: "image/png" }
    ]
  },
  other: {
    "msapplication-config": "/pwa/browserconfig.xml",
    "msapplication-TileColor": "#d6c2ae"
  }
};

export const viewport: Viewport = {
  themeColor: "#d6c2ae"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="id"><body><QueryProvider>{children}</QueryProvider></body></html>;
}
