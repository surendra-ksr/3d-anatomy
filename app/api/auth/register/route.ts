import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * POST /api/auth/register — create a login (email + password, bcrypt cost 10).
 * Returns 201 on success, 409 when the email is taken, 422 on bad input.
 */
export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const rawName = typeof body.name === "string" ? body.name.trim() : "";

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "a valid email is required" }, { status: 422 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "password must be at least 8 characters" },
      { status: 422 },
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "an account with this email already exists" },
      { status: 409 },
    );
  }

  const baseName = rawName || email.split("@")[0];
  let name = baseName;
  for (let i = 0; await prisma.user.findUnique({ where: { name } }); i++) {
    name = `${baseName}-${i + 1}`;
  }

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: bcrypt.hashSync(password, 10),
    },
  });
  return NextResponse.json(
    { ok: true, user: { id: user.id, name: user.name, email: user.email } },
    { status: 201 },
  );
}
