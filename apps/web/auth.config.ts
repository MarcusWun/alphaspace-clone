/**
 * Edge-safe Auth.js base config.
 *
 * No Prisma, no bcrypt, no Node.js-only imports — safe to import from
 * Next.js middleware which runs in the edge runtime.
 *
 * The full Node.js auth config (auth.ts) extends this and adds the
 * Prisma adapter, real credential validation, and OAuth providers.
 */

import type { NextAuthConfig } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

export const authConfig: NextAuthConfig = {
  providers: [
    CredentialsProvider({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      // authorize() is never called by the edge middleware — it is only
      // invoked by the /api/auth/callback/credentials API route (Node.js).
      // Return null here so this edge-safe copy does nothing on its own.
      authorize: () => null,
    }),
  ],
  pages: {
    signIn: "/auth/signin",
    verifyRequest: "/auth/verify-request",
    error: "/auth/error",
  },
};
