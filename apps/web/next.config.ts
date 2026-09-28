import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Server-only env vars — these must NOT appear in client bundles
  serverExternalPackages: ["@prisma/client", "prisma"],
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000"],
    },
  },
};

export default nextConfig;
