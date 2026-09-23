/**
 * Server-side helpers for data routes (Next route handlers).
 *
 * requireUserId resolves the NextAuth JWT from the request's session cookie
 * and returns the authenticated database user id, or null for anonymous
 * requests. All user-data routes must 401 when it returns null — data
 * isolation is enforced by scoping every query to this id.
 */
import { getToken } from "next-auth/jwt";

import { authSecret } from "@/lib/auth";

export async function requireUserId(request: Request): Promise<number | null> {
  // getToken reads the cookie header at runtime; a plain fetch Request
  // carries it, so the NextRequest-shaped type is satisfied via a cast.
  const req = request as unknown as Parameters<typeof getToken>[0]["req"];
  const token = await getToken({
    req,
    secret: authSecret,
    cookieName: process.env.NEXTAUTH_URL?.startsWith("https")
      ? "__Secure-next-auth.session-token"
      : "next-auth.session-token",
  });
  if (!token) return null;
  const id = typeof token.uid === "number" ? token.uid : Number(token.uid ?? token.sub);
  return Number.isFinite(id) && id > 0 ? id : null;
}
