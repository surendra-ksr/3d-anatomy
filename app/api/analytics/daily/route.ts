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

function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/**
 * GET /api/analytics/daily?days=30
 *
 * Prisma aggregation joining SymptomLog (pain) with ActivityLog (Energy
 * Drain) per day, plus a lag cross-correlation (0-3 days) that surfaces the
 * delayed exertion -> pain pattern typical of post-exertional malaise.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = Math.min(365, Math.max(7, Number(searchParams.get("days") ?? 30)));

  const todayUtc = new Date(new Date().toISOString().slice(0, 10));
  const since = new Date(todayUtc);
  since.setUTCDate(since.getUTCDate() - (days - 1));

  const userId = await getDefaultUserId();
  const [painGroups, activityGroups] = await Promise.all([
    prisma.symptomLog.groupBy({
      by: ["logDate"],
      where: { userId, logDate: { gte: since, lte: todayUtc } },
      _avg: { intensity: true },
      _max: { intensity: true },
      _sum: { intensity: true },
      _count: { _all: true },
    }),
    prisma.activityLog.groupBy({
      by: ["logDate"],
      where: { userId, logDate: { gte: since, lte: todayUtc } },
      _sum: { energyDrain: true, totalKcal: true },
      _count: { _all: true },
    }),
  ]);

  const painByIso = new Map(
    painGroups.map((g) => [g.logDate.toISOString().slice(0, 10), g]),
  );
  const drainByIso = new Map(
    activityGroups.map((g) => [g.logDate.toISOString().slice(0, 10), g]),
  );

  const daysOut: {
    date: string;
    painAvg: number | null;
    painMax: number | null;
    painLogCount: number;
    energyDrain: number | null;
    totalKcal: number | null;
    activityCount: number;
  }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const p = painByIso.get(iso);
    const a = drainByIso.get(iso);
    daysOut.push({
      date: iso,
      painAvg: p?._avg.intensity != null ? Math.round(p._avg.intensity * 100) / 100 : null,
      painMax: p?._max.intensity ?? null,
      painLogCount: p?._count._all ?? 0,
      energyDrain: a?._sum.energyDrain != null ? Math.round(a._sum.energyDrain * 100) / 100 : null,
      totalKcal: a?._sum.totalKcal != null ? Math.round(a._sum.totalKcal * 100) / 100 : null,
      activityCount: a?._count._all ?? 0,
    });
  }

  // PEM lag analysis: does pain tend to peak N days AFTER a high-drain day?
  const byLag: { lagDays: number; pearsonR: number | null; pairs: number }[] = [];
  for (let lag = 0; lag <= 3; lag++) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i + lag < daysOut.length; i++) {
      const drain = daysOut[i].energyDrain;
      const pain = daysOut[i + lag].painAvg;
      if (drain != null && pain != null) {
        xs.push(drain);
        ys.push(pain);
      }
    }
    const r = pearson(xs, ys);
    byLag.push({
      lagDays: lag,
      pearsonR: r != null ? Math.round(r * 1000) / 1000 : null,
      pairs: xs.length,
    });
  }
  const candidates = byLag.filter((e) => e.pearsonR != null && e.pairs >= 3);
  const maxPairs = Math.max(0, ...byLag.map((e) => e.pairs));
  let best = null as (typeof byLag)[number] | null;
  let interpretation: string;
  if (!candidates.length) {
    interpretation =
      "Not enough days with both activity and pain logs yet — save pacing " +
      "estimates and paint pain on more days to unlock the PEM lag analysis.";
  } else {
    best = candidates.reduce((a, b) =>
      (b.pearsonR ?? -1) > (a.pearsonR ?? -1) ? b : a,
    );
    const r0 = byLag.find((e) => e.lagDays === 0)?.pearsonR ?? null;
    if (best.lagDays >= 1 && (best.pearsonR ?? 0) >= 0.4 && (r0 == null || (best.pearsonR ?? 0) > r0)) {
      interpretation =
        `Pain tends to peak ~${best.lagDays} day(s) AFTER high energy drain ` +
        `(r = ${best.pearsonR} over ${best.pairs} day pairs) — the delayed ` +
        "pattern typical of post-exertional malaise.";
    } else if ((best.pearsonR ?? 0) >= 0.4) {
      interpretation =
        `Pain moves in step with same-day exertion (r = ${best.pearsonR} over ` +
        `${best.pairs} day pairs) — no delayed peak visible yet.`;
    } else {
      interpretation =
        "No strong drain→pain correlation in this window yet (|r| < 0.4). " +
        "Keep logging — patterns need at least a couple of weeks.";
    }
  }

  const daysWithLogs = daysOut.filter((d) => d.painLogCount > 0).length;
  const daysWithActivity = daysOut.filter((d) => d.activityCount > 0).length;

  return NextResponse.json({
    range: days,
    days: daysOut,
    pem: {
      byLag,
      bestLagDays: best?.lagDays ?? null,
      pearsonAtBest: best?.pearsonR ?? null,
      daysWithPairedData: maxPairs,
      interpretation,
    },
    summary: {
      daysWithLogs,
      daysWithActivity,
      totalPainLogs: daysOut.reduce((a, d) => a + d.painLogCount, 0),
      totalActivities: daysOut.reduce((a, d) => a + d.activityCount, 0),
    },
  });
}
