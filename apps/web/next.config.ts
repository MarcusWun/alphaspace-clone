import type { NextConfig } from "next";

const apiUrl = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  output: "standalone",
  // Server-only env vars — these must NOT appear in client bundles
  serverExternalPackages: ["@prisma/client", "prisma"],
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000"],
    },
  },
  // Proxy /api/* (except Next.js auth) to the Fastify API in dev
  async rewrites() {
    return [
      {
        source: "/api/:path((?!auth).*)",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
