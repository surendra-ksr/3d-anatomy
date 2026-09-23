"use client";

/**
 * /dashboard - Energy vs Symptom Correlation (2D analytics).
 *
 * Dual-axis Recharts line chart over the Prisma-aggregated daily series
 * (GET /api/analytics/daily):
 *   axis 1 (left, orange)  - total daily Energy Drain from saved pacing
 *                            estimates (ActivityLog)
 *   axis 2 (right, rose)   - aggregate daily pain intensity (SymptomLog)
 * plus the PEM lag cross-correlation card, which surfaces the delayed
 * exertion -> pain spike pattern (spike on day 1, systemic pain on day 2-3).
 *
 * Companion clusters view lives on the main viewer ("Insights" panel);
 * this page focuses on the time series.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { LowStimProvider, useLowStim } from "@/lib/low-stim";
import ClusterList from "@/components/ClusterList";
import ExportPanel from "@/components/ExportPanel";
import type {
  ClustersResponse,
  DailyAnalyticsResponse,
} from "@/lib/types";

const RANGES = [
  { days: 14, label: "2 weeks" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;

function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function DashboardBody() {
  const { lowStim, t } = useLowStim();
  const [range, setRange] = useState<(typeof RANGES)[number]["days"]>(30);
  const [daily, setDaily] = useState<DailyAnalyticsResponse | null>(null);
  const [clusters, setClusters] = useState<ClustersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDaily(null);
    fetch(`/api/analytics/daily?days=${range}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: DailyAnalyticsResponse) => {
        if (!cancelled) setDaily(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  useEffect(() => {
    fetch("/api/py/analytics/clusters?days=90&minIntensity=1&minSupport=2", {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: ClustersResponse) => setClusters(d))
      .catch(() => undefined);
  }, []);

  const chartData = useMemo(
    () =>
      (daily?.days ?? []).map((d) => ({
        ...d,
        label: dayLabel(d.date),
      })),
    [daily],
  );

  const card = {
    borderColor: lowStim ? "#fff" : "rgba(255,255,255,0.12)",
  } as const;

  const hasData = (daily?.summary.totalPainLogs ?? 0) + (daily?.summary.totalActivities ?? 0) > 0;

  return (
    <main
      className="min-h-dvh p-5 text-slate-200 md:p-8"
      style={{ background: lowStim ? "#000" : "#0b0f17" }}
    >
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Energy vs Symptoms — correlation dashboard
            </h1>
            <p className="mt-1 text-[12px] text-slate-400">
              Daily Energy Drain (saved pacing estimates) against aggregate pain
              intensity (painted logs) — the delayed pattern is PEM.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {RANGES.map((r) => (
              <button
                key={r.days}
                onClick={() => setRange(r.days)}
                className="rounded-md border px-2.5 py-1.5 text-[11px] font-medium"
                style={{
                  ...card,
                  background: range === r.days ? (lowStim ? "#fff" : "#0ea5e9") : "transparent",
                  color: range === r.days ? (lowStim ? "#000" : "#fff") : "inherit",
                  fontWeight: range === r.days ? 700 : 400,
                }}
                aria-pressed={range === r.days}
              >
                {t(r.label)}
              </button>
            ))}
            <Link
              href="/"
              className="rounded-md border px-2.5 py-1.5 text-[11px] font-medium"
              style={card}
            >
              ← 3D viewer
            </Link>
          </div>
        </header>

        {/* PEM lag card */}
        <section
          className="mt-5 rounded-xl border p-4"
          style={{
            ...card,
            background: lowStim ? "#0a0a0a" : "rgba(244,63,94,0.06)",
          }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-400">
            Post-exertional malaise lag analysis
          </p>
          {daily ? (
            <>
              <p className="mt-1.5 text-[13px] leading-relaxed">
                {daily.pem.interpretation}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
                {daily.pem.byLag.map((e) => (
                  <span
                    key={e.lagDays}
                    className="rounded-full px-2 py-0.5"
                    style={{
                      background:
                        daily.pem.bestLagDays === e.lagDays
                          ? "rgba(244,63,94,0.25)"
                          : lowStim
                            ? "#1a1a1a"
                            : "rgba(148,163,184,0.12)",
                      color:
                        daily.pem.bestLagDays === e.lagDays ? "#fda4af" : "inherit",
                    }}
                  >
                    +{e.lagDays}d lag: r = {e.pearsonR ?? "–"} (n={e.pairs} days)
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-1.5 animate-pulse text-[13px] opacity-60">…</p>
          )}
        </section>

        {/* dual-axis chart */}
        <section className="mt-5 rounded-xl border p-4" style={card}>
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wider opacity-60">
              Daily series (last {range} days)
            </p>
            <p className="text-[10px] opacity-60">
              <span className="text-orange-400">━</span> energy drain ·{" "}
              <span className="text-rose-400">━</span> avg pain (0–10)
            </p>
          </div>
          {error && (
            <p className="mt-3 rounded bg-red-950/70 px-3 py-2 text-xs text-red-300">
              Failed to load analytics: {error}
            </p>
          )}
          {!error && !daily && (
            <p className="mt-3 animate-pulse text-xs opacity-60">Loading series…</p>
          )}
          {daily && (
            <div className="mt-3 h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={lowStim ? "#333" : "#1e293b"} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "#94a3b8", fontSize: 10 }}
                    tickMargin={6}
                  />
                  <YAxis
                    yAxisId="drain"
                    tick={{ fill: "#fb923c", fontSize: 10 }}
                    width={36}
                    label={{
                      value: "Energy Drain",
                      angle: -90,
                      position: "insideLeft",
                      fill: "#fb923c",
                      fontSize: 10,
                    }}
                  />
                  <YAxis
                    yAxisId="pain"
                    orientation="right"
                    domain={[0, 10]}
                    tick={{ fill: "#fb7185", fontSize: 10 }}
                    width={28}
                    label={{
                      value: "pain (avg)",
                      angle: 90,
                      position: "insideRight",
                      fill: "#fb7185",
                      fontSize: 10,
                    }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#0f172a",
                      border: "1px solid #334155",
                      borderRadius: 8,
                      fontSize: 12,
                      color: "#e2e8f0",
                    }}
                    labelStyle={{ color: "#94a3b8" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    yAxisId="drain"
                    type="monotone"
                    dataKey="energyDrain"
                    name="Energy Drain (activity)"
                    stroke="#fb923c"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls
                  />
                  <Line
                    yAxisId="pain"
                    type="monotone"
                    dataKey="painAvg"
                    name="Pain (avg of painted)"
                    stroke="#fb7185"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          {!hasData && daily && (
            <p className="mt-2 rounded-md border border-dashed p-3 text-[12px] leading-relaxed opacity-80" style={card}>
              Nothing logged in this window yet. Two ways to fill it with real
              data: (1) paint pain on the 3D model (scrub the timeline to a
              past day to backfill it), and (2) hit ⚡ Pacing → “Log this
              activity” after estimating. Each saved activity / rating appears
              here the moment it exists.
            </p>
          )}
        </section>

        {/* clusters */}
        <section className="mt-5 rounded-xl border p-4" style={card}>
          <p className="text-[10px] font-semibold uppercase tracking-wider opacity-60">
            Symptom clusters (what tends to flare together)
          </p>
          <div className="mt-3">
            <ClusterList data={clusters} />
          </div>
        </section>

        {/* clinical export */}
        <ExportPanel />

        <footer className="mt-6 text-[10px] leading-relaxed text-slate-500">
          Energy Drain model: de Leva/Dempster segment anthropometry + Elia
          muscle metabolic rate ({daily ? "see /api/metabolic-cost/groups" : "…"}).
          Lag analysis: Pearson r between daily drain and pain at 0–3 day lags.
          Descriptive self-tracking only — not a diagnostic tool.
        </footer>
      </div>
    </main>
  );
}

export default function DashboardPage() {
  return (
    <LowStimProvider>
      <DashboardBody />
    </LowStimProvider>
  );
}
