/**
 * NextAuth (Auth.js v4) configuration — JWT strategy, credentials provider.
 *
 * - Sessions are stateless JWTs (no database sessions), signed with
 *   NEXTAUTH_SECRET.
 * - The signed-in user's database id rides inside the token (`token.uid`),
 *   so every data route can scope queries to the authenticated user.
 * - Passwords are bcrypt hashes in users.passwordHash (bcryptjs, cost 10).
 * - Registration happens via /api/auth/register; login via /login.
 *
 * The signed NextAuth token is never sent to FastAPI. Instead, middleware.ts
 * mints a short-lived HS256 internal JWT (AUTH_INTERNAL_SECRET) that the
 * Python service validates — see middleware.ts + backend/main.py.
 */
import type { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import prisma from "@/lib/prisma";

export const authSecret =
  process.env.NEXTAUTH_SECRET ?? "dev-insecure-secret-change-me";

/** Secret used ONLY for the Next.js -> FastAPI internal bearer tokens. */
export const internalJwtSecret =
  process.env.AUTH_INTERNAL_SECRET ?? "dev-insecure-internal-secret-change-me";

export const authOptions: NextAuthOptions = {
  secret: authSecret,
  session: {
    strategy: "jwt",
    // rotate/refresh window
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "Email & password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;
        if (!email || !password || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          return null;
        }
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user?.passwordHash || !user.email) return null;
        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;
        // the object returned here is embedded into the JWT on sign-in
        return { id: String(user.id), name: user.name, email: user.email };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.uid = Number(user.id);
        token.email = user.email ?? token.email ?? null;
        token.name = user.name ?? token.name ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = typeof token.uid === "number" ? token.uid : Number(token.sub ?? 0);
        session.user.email = (token.email as string | null) ?? null;
        session.user.name = (token.name as string | null) ?? null;
      }
      return session;
    },
  },
};
