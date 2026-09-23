import type { DefaultSession, DefaultUser } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      /** database id (users.id) of the authenticated profile */
      id: number;
      name: string | null;
      email: string | null;
    } & DefaultSession["user"];
  }

  interface User extends DefaultUser {
    id: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    /** database id (users.id) */
    uid?: number;
    email?: string | null;
    name?: string | null;
  }
}
