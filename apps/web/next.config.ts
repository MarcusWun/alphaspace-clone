import type { NextConfig } from "next";

// INTERNAL_API_URL is the server-side proxy target — it must resolve from
// inside the web container (e.g., the Docker service name "api").
// NEXT_PUBLIC_API_URL is the browser-visible public URL and is intentionally
// NOT used here: it's baked as undefined at build time when not passed as a
// Docker build ARG, which was the root cause of WORKSPACES-500.
const apiUrl =
  process.env["INTERNAL_API_URL"] ??
  process.env["NEXT_PUBLIC_API_URL"] ??
  "http://localhost:3001";

const nextConfig: NextConfig = {
  output: "standalone",
  // Server-only env vars — these must NOT appear in client bundles
  serverExternalPackages: ["@prisma/client", "prisma"],
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000"],
    },
  },
  // Proxy /api/* (except Next.js auth) to the Fastify API
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
