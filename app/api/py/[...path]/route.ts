/**
 * Authenticated proxy to the FastAPI service (/api/py/* → $FASTAPI_URL/api/*).
 *
 * This is the ONLY path from the browser to the Python backend. It resolves
 * the NextAuth session, mints a short-lived HS256 internal JWT
 * (AUTH_INTERNAL_SECRET) carrying the authenticated user id + email, and
 * forwards the request with `Authorization: Bearer <token>`. FastAPI
 * validates the token on every call and scopes every query to that user, so
 * data isolation is enforced end-to-end; browser cookies never leave the
 * Next origin and the backend is unreachable without a valid token.
 */
import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { SignJWT } from "jose";

import { authSecret, internalJwtSecret } from "@/lib/auth";

const BACKEND = (process.env.FASTAPI_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

const SESSION_COOKIE = process.env.NEXTAUTH_URL?.startsWith("https")
  ? "__Secure-next-auth.session-token"
  : "next-auth.session-token";

async function internalToken(request: Request): Promise<string | null> {
  const req = request as unknown as Parameters<typeof getToken>[0]["req"];
  const token = await getToken({ req, secret: authSecret, cookieName: SESSION_COOKIE });
  if (!token?.uid) return null;
  return new SignJWT({
    email: (token.email as string | null) ?? null,
    name: (token.name as string | null) ?? null,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(token.uid))
    .setIssuedAt()
    .setIssuer("anatomy-engine")
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(internalJwtSecret));
}

async function proxy(
  request: Request,
  ctx: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const token = await internalToken(request);
  if (token == null) {
    return NextResponse.json({ error: "authentication required" }, { status: 401 });
  }
  const { path } = await ctx.params;

  const url = new URL(`/api/${(path ?? []).join("/")}`, BACKEND);
  url.search = new URL(request.url).search;

  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.delete("cookie"); // browser session stays on this origin
  headers.delete("host");
  headers.delete("connection");
  headers.delete("content-length");

  const hasBody = !["GET", "HEAD"].includes(request.method);
  const body = hasBody ? await request.arrayBuffer() : undefined;

  const upstream = await fetch(url, {
    method: request.method,
    headers,
    body,
    // same-service call inside the container; never follow escapes silently
    redirect: "manual",
    cache: "no-store",
  });

  const out = new Headers(upstream.headers);
  out.delete("transfer-encoding");
  out.delete("content-encoding");
  out.delete("content-length");
  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
export const HEAD = proxy;
