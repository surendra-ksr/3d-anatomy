/**
 * Middleware — authentication gate for the application pages.
 *
 * Anonymous visitors to / and /dashboard are redirected to /login?from=<path>.
 * (The /api/py/* backend proxy lives in app/api/py/[...path]/route.ts, which
 * enforces the session itself and injects the internal bearer token for the
 * FastAPI service. The /api/pain-logs, /api/activity-logs and
 * /api/analytics/* route handlers likewise require the session.)
 */
import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const SECRET =
  process.env.NEXTAUTH_SECRET ?? "dev-insecure-secret-change-me";

function sessionCookieName(req: NextRequest): string {
  return req.nextUrl.protocol === "https:" ||
    (process.env.NEXTAUTH_URL ?? "").startsWith("https")
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token";
}

export async function middleware(req: NextRequest) {
  const token = await getToken({
    req,
    secret: SECRET,
    cookieName: sessionCookieName(req),
  });
  if (!token?.uid) {
    const login = new URL("/login", req.url);
    login.searchParams.set("from", req.nextUrl.pathname === "/" ? "/" : req.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/dashboard"],
};
