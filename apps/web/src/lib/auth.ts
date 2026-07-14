import { prisma } from "@housetour/db";
import { compare } from "bcryptjs";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { env } from "./env";

export const authOptions: NextAuthOptions = {
  secret: env.authSecret,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;
        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLowerCase() },
          include: {
            memberships: {
              include: { organization: true },
              take: 1,
              orderBy: { createdAt: "asc" },
            },
          },
        });
        if (!user?.passwordHash) return null;
        const ok = await compare(credentials.password, user.passwordHash);
        if (!ok) return null;
        const membership = user.memberships[0];
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          organizationId: membership?.organizationId,
          organizationSlug: membership?.organization.slug,
          role: membership?.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        const u = user as {
          organizationId?: string;
          organizationSlug?: string;
          role?: string;
        };
        token.organizationId = u.organizationId;
        token.organizationSlug = u.organizationSlug;
        token.role = u.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.organizationId = token.organizationId as string | undefined;
        session.user.organizationSlug = token.organizationSlug as string | undefined;
        session.user.role = token.role as string | undefined;
      }
      return session;
    },
  },
};
