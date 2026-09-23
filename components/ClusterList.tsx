"use client";

/**
 * ClusterList - shared rendering of symptom-cluster insights (pair rules +
 * region clusters from /api/py/analytics/clusters). Used by the in-viewer
 * AnalyticsPanel and the /dashboard page.
 */
import type { ClustersResponse } from "@/lib/types";
import { useLowStim } from "@/lib/low-stim";

function confColor(conf: number): string {
  if (conf >= 0.8) return "#dc2626";
  if (conf >= 0.6) return "#f97316";
  if (conf >= 0.4) return "#eab308";
  return "#22c55e";
}

export default function ClusterList({
  data,
  compact = false,
}: {
  data: ClustersResponse | null;
  compact?: boolean;
}) {
  const { lowStim, t } = useLowStim();
  const border = { borderColor: lowStim ? "#fff" : "rgba(255,255,255,0.12)" };

  if (!data) {
    return (
      <p className="animate-pulse text-xs opacity-60">Analyzing flare history…</p>
    );
  }

  const noData = data.pairRules.length === 0 && data.regionClusters.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] opacity-70">
        <span>
          {data.summary.daysWithFlares} day(s) with flares ·{" "}
          {data.summary.logRowsAnalyzed} log rows
        </span>
        <span>flare threshold: pain ≥ {data.summary.minIntensity}</span>
      </div>

      {noData && (
        <p className="rounded-md border border-dashed p-3 text-[12px] leading-relaxed opacity-80" style={border}>
          {data.note ??
            "No co-occurrence patterns yet — paint pain on more days (scrub the timeline to backfill) and they will show up here."}
        </p>
      )}

      {data.regionClusters.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider opacity-60">
            Regions that flare together
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {data.regionClusters.slice(0, compact ? 3 : 6).map((c, i) => (
              <li
                key={i}
                className="rounded-md border p-2 text-[12px] leading-snug"
                style={border}
              >
                <div className="flex flex-wrap gap-1">
                  {c.members.map((m) => (
                    <span
                      key={m}
                      className="rounded px-1.5 py-0.5 text-[11px]"
                      style={{
                        background: lowStim ? "#1d4ed8" : "rgba(56,189,248,0.14)",
                        color: lowStim ? "#fff" : "#7dd3fc",
                      }}
                    >
                      {t(m)}
                    </span>
                  ))}
                </div>
                <p className="mt-1 text-[10px] opacity-60">
                  co-flared on {c.support} day(s) ·{" "}
                  {Math.round(c.shareOfFlareDays * 100)}% of flare days
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.pairRules.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider opacity-60">
            If-this-then-that flare rules
          </p>
          <ul className="mt-1.5 space-y-2">
            {data.pairRules.slice(0, compact ? 4 : 8).map((r, i) => (
              <li key={i} className="text-[12px] leading-snug">
                <p>{t(r.statement)}</p>
                <div className="mt-1 flex items-center gap-2">
                  <div
                    className="h-1.5 flex-1 overflow-hidden rounded-full"
                    style={{
                      background: lowStim ? "#333" : "rgba(148,163,184,0.2)",
                    }}
                    role="meter"
                    aria-valuenow={Math.round(r.confidence * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, r.confidence * 100)}%`,
                        background: confColor(r.confidence),
                      }}
                    />
                  </div>
                  <span className="w-10 text-right text-[10px] tabular-nums opacity-70">
                    {Math.round(r.confidence * 100)}%
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="border-t pt-2 text-[9px] leading-snug opacity-50" style={border}>
        {data.disclaimer}
      </p>
    </div>
  );
}
