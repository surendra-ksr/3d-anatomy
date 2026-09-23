import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

const DEFAULT_USER = process.env.ANATOMY_DEFAULT_USER ?? "you";

async function getDefaultUserId() {
  const user = await prisma.user.upsert({
    where: { name: DEFAULT_USER },
    create: { name: DEFAULT_USER },
    update: {},
  });
  return user.id;
}

/**
 * GET /api/pain-logs?since=YYYY-MM-DD
 * Today's (or all) painted pain ratings - SymptomLog rows.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const since = searchParams.get("since");
  const userId = await getDefaultUserId();
  const logs = await prisma.symptomLog.findMany({
    where: {
      userId,
      ...(since && !Number.isNaN(Date.parse(since))
        ? { logDate: { gte: new Date(since) } }
        : {}),
    },
    orderBy: { timestamp: "desc" },
    take: 500,
  });
  return NextResponse.json({
    user: DEFAULT_USER,
    logs: logs.map((l) => ({
      fmaId: l.fmaId,
      intensity: l.intensity,
      note: l.note,
      logDate: l.logDate.toISOString().slice(0, 10),
      timestamp: l.timestamp.toISOString(),
    })),
  });
}

interface PainEntryBody {
  fmaId?: unknown;
  intensity?: unknown;
  note?: unknown;
}

/**
 * POST /api/pain-logs
 * Body: { entries: [{ fmaId, intensity (1-10), note? }] }
 * Upserts today's rating per structure (one SymptomLog per user/FMA/day).
 */
export async function POST(request: Request) {
  let body: { entries?: PainEntryBody[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const entries = body.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    return NextResponse.json(
      { error: "entries: non-empty array required" },
      { status: 400 },
    );
  }

  const normalized = [];
  for (const entry of entries) {
    const fmaIdRaw = typeof entry.fmaId === "string" ? entry.fmaId.trim().toUpperCase() : "";
    const fmaId = fmaIdRaw.startsWith("FMA") ? fmaIdRaw : `FMA${fmaIdRaw}`;
    const intensity = Number(entry.intensity);
    if (!/^FMA[0-9A-Za-z]+$/.test(fmaId)) {
      return NextResponse.json({ error: `bad fmaId: ${entry.fmaId}` }, { status: 400 });
    }
    if (!Number.isInteger(intensity) || intensity < 1 || intensity > 10) {
      return NextResponse.json(
        { error: `intensity must be an integer 1-10 for ${fmaId}` },
        { status: 400 },
      );
    }
    const note = typeof entry.note === "string" ? entry.note.slice(0, 500) : null;
    normalized.push({ fmaId, intensity, note });
  }

  const userId = await getDefaultUserId();
  const logDate = new Date(new Date().toISOString().slice(0, 10));
  const saved = [];
  for (const entry of normalized) {
    const row = await prisma.symptomLog.upsert({
      where: {
        userId_fmaId_logDate: {
          userId,
          fmaId: entry.fmaId,
          logDate,
        },
      },
      create: {
        userId,
        fmaId: entry.fmaId,
        intensity: entry.intensity,
        note: entry.note,
        logDate,
      },
      update: { intensity: entry.intensity, note: entry.note },
    });
    saved.push({
      fmaId: row.fmaId,
      intensity: row.intensity,
      logDate: row.logDate.toISOString().slice(0, 10),
      timestamp: row.timestamp.toISOString(),
    });
  }
  return NextResponse.json({ saved, logDate: logDate.toISOString().slice(0, 10) });
}

/**
 * DELETE /api/pain-logs?fmaId=FMA13377
 * Clears one structure's rating, or the whole current pain map.
 */
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const fmaIdRaw = searchParams.get("fmaId");
  const userId = await getDefaultUserId();
  const logDate = new Date(new Date().toISOString().slice(0, 10));
  const deleted = await prisma.symptomLog.deleteMany({
    where: {
      userId,
      logDate,
      ...(fmaIdRaw
        ? {
            fmaId: fmaIdRaw.toUpperCase().startsWith("FMA")
              ? fmaIdRaw.toUpperCase()
              : `FMA${fmaIdRaw.toUpperCase()}`,
          }
        : {}),
    },
  });
  return NextResponse.json({ deleted: deleted.count });
}
