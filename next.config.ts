import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: [
    "127.0.0.1",
    "rhasia-scret.vercel.app",
  ],
};

export default nextConfig;
