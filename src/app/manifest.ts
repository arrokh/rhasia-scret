import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "rhasia-scret",
    short_name: "rhasia-scret",
    description: "Autentikator bersama tanpa pengetahuan",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F8F4ED",
    theme_color: "#E5A72E",
    lang: "id-ID",
    dir: "ltr",
    categories: ["security", "utilities"],
    icons: [
      { src: "/pwa/android/launchericon-48x48.png", sizes: "48x48", type: "image/png" },
      { src: "/pwa/android/launchericon-72x72.png", sizes: "72x72", type: "image/png" },
      { src: "/pwa/android/launchericon-96x96.png", sizes: "96x96", type: "image/png" },
      { src: "/pwa/android/launchericon-144x144.png", sizes: "144x144", type: "image/png" },
      { src: "/pwa/android/launchericon-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "/pwa/android/launchericon-512x512.png", sizes: "512x512", type: "image/png" },
      { src: "/pwa/icon512_rounded.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/icon512_maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
