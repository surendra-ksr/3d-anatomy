import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { requireUserId } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/pain-logs?since=...&from=...&until=...
 * Pain ratings for a day window - feeds the live pain map (`since`) and the
 * timeline scrubber (`from`+`until`).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = await requireUserId(request);
  if (userId == null) {
    return NextResponse.json({ error: "authentication required" }, { status: 401 });
  }

  const window: { gte?: Date; lte?: Date } = {};
  for (const [param, op] of [
    ["since", "gte"],
    ["from", "gte"],
    ["until", "lte"],
  ] as const) {
    const value = searchParams.get(param);
    if (!value) continue;
    if (!DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
      return NextResponse.json({ error: `bad '${param}' date` }, { status: 400 });
    }
    if (op === "gte") window.gte = new Date(value);
    else window.lte = new Date(value);
  }

  const logs = await prisma.symptomLog.findMany({
    where: { userId, logDate: window },
    orderBy: { timestamp: "desc" },
    take: 2000,
  });
  return NextResponse.json({
    user: userId,
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
  logDate?: unknown;
}

/**
 * POST /api/pain-logs
 * Body: { entries: [{ fmaId, intensity (1-10), note?, logDate? }] }
 * Upserts one rating per structure per day; logDate backfills history
 * (defaults to today UTC).
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

  const todayIso = new Date().toISOString().slice(0, 10);
  const normalized = [];
  for (const entry of entries) {
    const fmaIdRaw = typeof entry.fmaId === "string" ? entry.fmaId.trim().toUpperCase() : "";
    const fmaId = fmaIdRaw.startsWith("FMA") ? fmaIdRaw : `FMA${fmaIdRaw}`;
    const intensity = Number(entry.intensity);
    const logDateIso =
      typeof entry.logDate === "string" && DATE_RE.test(entry.logDate)
        ? entry.logDate
        : todayIso;
    if (!/^FMA[0-9A-Za-z]+$/.test(fmaId)) {
      return NextResponse.json({ error: `bad fmaId: ${entry.fmaId}` }, { status: 400 });
    }
    if (!Number.isInteger(intensity) || intensity < 1 || intensity > 10) {
      return NextResponse.json(
        { error: `intensity must be an integer 1-10 for ${fmaId}` },
        { status: 400 },
      );
    }
    if (Date.parse(logDateIso) > Date.parse(todayIso)) {
      return NextResponse.json(
        { error: `logDate ${logDateIso} is in the future` },
        { status: 400 },
      );
    }
    const note = typeof entry.note === "string" ? entry.note.slice(0, 500) : null;
    normalized.push({ fmaId, intensity, note, logDateIso });
  }

  const userId = await requireUserId(request);
  if (userId == null) {
    return NextResponse.json({ error: "authentication required" }, { status: 401 });
  }
  const saved = [];
  for (const entry of normalized) {
    const logDate = new Date(entry.logDateIso);
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
  return NextResponse.json({
    saved,
    logDate: saved[0]?.logDate ?? todayIso,
  });
}

/**
 * DELETE /api/pain-logs?fmaId=FMA13377&logDate=2026-09-20
 * Clears one structure's rating on a day (default today), or the whole day
 * when fmaId is omitted.
 */
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const fmaIdRaw = searchParams.get("fmaId");
  const logDateRaw = searchParams.get("logDate");
  const todayIso = new Date().toISOString().slice(0, 10);
  const logDateIso = logDateRaw && DATE_RE.test(logDateRaw) ? logDateRaw : todayIso;
  const userId = await requireUserId(request);
  if (userId == null) {
    return NextResponse.json({ error: "authentication required" }, { status: 401 });
  }
  const deleted = await prisma.symptomLog.deleteMany({
    where: {
      userId,
      logDate: new Date(logDateIso),
      ...(fmaIdRaw
        ? {
            fmaId: fmaIdRaw.toUpperCase().startsWith("FMA")
              ? fmaIdRaw.toUpperCase()
              : `FMA${fmaIdRaw.toUpperCase()}`,
          }
        : {}),
    },
  });
  return NextResponse.json({ deleted: deleted.count, logDate: logDateIso });
}
