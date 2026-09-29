/**
 * Auth.js v5 configuration for Alpha.
 *
 * Providers:
 *   - Email (magic link via nodemailer SMTP)
 *   - Credentials (email + bcrypt password)
 *   - GitHub OAuth (enabled only when AUTH_GITHUB_ID + AUTH_GITHUB_SECRET are set)
 *   - Google OAuth (enabled only when AUTH_GOOGLE_ID + AUTH_GOOGLE_SECRET are set)
 *
 * Sessions use JWT strategy so the edge-runtime middleware (middleware.ts) can
 * decode them without a database round-trip. User/account records are still
 * persisted in Postgres via the Prisma adapter.
 */

import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { authConfig } from "./auth.config";
import CredentialsProvider from "next-auth/providers/credentials";
import EmailProvider from "next-auth/providers/nodemailer";
import GitHubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { prisma } from "@alpha/db";

// AUTH_SECRET and AUTH_URL are validated at runtime by Auth.js itself;
// asserting them at module level would throw during `next build` when env
// vars are not injected. Auth.js will surface a clear error on first request
// if they are missing in production.

const providers = [
  CredentialsProvider({
    name: "Email & Password",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials?.password) return null;

      const user = await prisma.user.findUnique({
        where: { email: credentials.email as string },
        select: { id: true, email: true, name: true, image: true, passwordHash: true },
      });
      if (!user?.passwordHash) return null;

      const valid = await bcrypt.compare(
        credentials.password as string,
        user.passwordHash
      );
      if (!valid) return null;

      return { id: user.id, email: user.email, name: user.name, image: user.image };
    },
  }),
];

// Email magic-link — only add if SMTP server is configured
if (process.env["AUTH_EMAIL_SERVER"]) {
  providers.push(
    EmailProvider({
      server: process.env["AUTH_EMAIL_SERVER"],
      from: process.env["AUTH_EMAIL_FROM"] ?? "noreply@example.com",
    }) as never
  );
}

// GitHub OAuth — only add if credentials are present
if (process.env["AUTH_GITHUB_ID"] && process.env["AUTH_GITHUB_SECRET"]) {
  providers.push(
    GitHubProvider({
      clientId: process.env["AUTH_GITHUB_ID"],
      clientSecret: process.env["AUTH_GITHUB_SECRET"],
    }) as never
  );
}

// Google OAuth — only add if credentials are present
if (process.env["AUTH_GOOGLE_ID"] && process.env["AUTH_GOOGLE_SECRET"]) {
  providers.push(
    GoogleProvider({
      clientId: process.env["AUTH_GOOGLE_ID"],
      clientSecret: process.env["AUTH_GOOGLE_SECRET"],
    }) as never
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  // JWT strategy: the session token is a signed JWT stored in a cookie.
  // This lets the edge-runtime middleware (middleware.ts) decode it without
  // a database lookup. User/account records are still persisted via the adapter.
  session: { strategy: "jwt" },
  providers,
  callbacks: {
    jwt({ token, user }) {
      // On first sign-in `user` is present; persist the DB user id into the token.
      if (user?.id) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});
