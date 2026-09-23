import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { requireUserId } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/activity-logs?days=30
 * Saved Energy-Drain estimates (the user's activity history).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = Math.min(365, Math.max(1, Number(searchParams.get("days") ?? 30)));
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days + 1);
  const userId = await requireUserId(request);
  if (userId == null) {
    return NextResponse.json({ error: "authentication required" }, { status: 401 });
  }
  const rows = await prisma.activityLog.findMany({
    where: { userId, logDate: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return NextResponse.json({
    user: userId,
    activities: rows.map((a) => ({
      id: a.id,
      fmaIds: a.fmaIds,
      minutes: a.minutes,
      severity: a.severity,
      energyDrain: a.energyDrain,
      totalKcal: a.totalKcal,
      logDate: a.logDate.toISOString().slice(0, 10),
      createdAt: a.createdAt.toISOString(),
    })),
  });
}

interface ActivityBody {
  fmaIds?: unknown;
  minutes?: unknown;
  severity?: unknown;
  energyDrain?: unknown;
  totalKcal?: unknown;
  logDate?: unknown;
}

/**
 * POST /api/activity-logs
 * Persists one Energy-Drain estimate from the pacing estimator so the
 * dashboard can correlate exertion with symptom flares (PEM).
 * Body: { fmaIds: string[], minutes, severity, energyDrain, totalKcal, logDate? }
 */
export async function POST(request: Request) {
  let body: ActivityBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const fmaIds = Array.isArray(body.fmaIds)
    ? [
        ...new Set(
          body.fmaIds
            .slice(0, 64)
            .map((v) => String(v).trim().toUpperCase())
            .map((v) => (v.startsWith("FMA") ? v : `FMA${v}`))
            .filter((v) => /^FMA[0-9A-Za-z]+$/.test(v)),
        ),
      ]
    : [];
  const minutes = Math.round(Number(body.minutes));
  const severity = String(body.severity ?? "moderate");
  const energyDrain = Number(body.energyDrain);
  const totalKcal = Number(body.totalKcal);
  const todayIso = new Date().toISOString().slice(0, 10);
  const logDateIso =
    typeof body.logDate === "string" && DATE_RE.test(body.logDate)
      ? body.logDate
      : todayIso;

  if (fmaIds.length === 0) {
    return NextResponse.json({ error: "fmaIds: non-empty array required" }, { status: 400 });
  }
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) {
    return NextResponse.json({ error: "minutes out of range" }, { status: 400 });
  }
  if (!["mild", "moderate", "severe"].includes(severity)) {
    return NextResponse.json({ error: "severity must be mild|moderate|severe" }, { status: 400 });
  }
  if (!Number.isFinite(energyDrain) || energyDrain < 0 || energyDrain > 100) {
    return NextResponse.json({ error: "energyDrain out of range" }, { status: 400 });
  }
  if (!Number.isFinite(totalKcal) || totalKcal < 0) {
    return NextResponse.json({ error: "totalKcal out of range" }, { status: 400 });
  }
  if (Date.parse(logDateIso) > Date.parse(todayIso)) {
    return NextResponse.json({ error: "logDate is in the future" }, { status: 400 });
  }

  const userId = await requireUserId(request);
  if (userId == null) {
    return NextResponse.json({ error: "authentication required" }, { status: 401 });
  }
  const row = await prisma.activityLog.create({
    data: {
      userId,
      fmaIds,
      minutes,
      severity,
      energyDrain,
      totalKcal,
      logDate: new Date(logDateIso),
    },
  });
  return NextResponse.json({
    saved: {
      id: row.id,
      fmaIds: row.fmaIds,
      minutes: row.minutes,
      severity: row.severity,
      energyDrain: row.energyDrain,
      totalKcal: row.totalKcal,
      logDate: row.logDate.toISOString().slice(0, 10),
    },
  });
}
