"use client";

/**
 * AnalyticsPanel - in-viewer insights dialog: symptom clusters over the
 * user's logged history plus the PEM (post-exertional malaise) lag readout.
 * Deep-links to /dashboard for the full dual-axis chart.
 */
import { useEffect, useState } from "react";
import Link from "next/link";

import ClusterList from "@/components/ClusterList";
import { useLowStim } from "@/lib/low-stim";
import type { ClustersResponse, DailyAnalyticsResponse } from "@/lib/types";

export default function AnalyticsPanel({ onClose }: { onClose: () => void }) {
  const { lowStim, t } = useLowStim();
  const [clusters, setClusters] = useState<ClustersResponse | null>(null);
  const [daily, setDaily] = useState<DailyAnalyticsResponse | null>(null);

  useEffect(() => {
    fetch("/api/py/analytics/clusters?days=90&minIntensity=1&minSupport=2", {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: ClustersResponse) => setClusters(d))
      .catch(() => undefined);
    fetch("/api/analytics/daily?days=30", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: DailyAnalyticsResponse) => setDaily(d))
      .catch(() => undefined);
  }, []);

  return (
    <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
      <div
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl border p-5 shadow-2xl"
        style={{
          background: lowStim ? "#000" : "#0f172af5",
          borderColor: lowStim ? "#fff" : "#ffffff22",
          color: lowStim ? "#fff" : "#e2e8f0",
          borderWidth: lowStim ? 2 : 1,
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Analytics — your flare patterns</h2>
            <p className="mt-0.5 text-[11px] opacity-70">
              Computed from your own logged pain + pacing history.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded px-2 py-0.5 text-slate-400 hover:text-slate-100"
            aria-label="close"
          >
            ✕
          </button>
        </div>

        {daily && (
          <div
            className="mt-4 rounded-lg border p-3"
            style={{
              borderColor: lowStim ? "#fff" : "rgba(255,255,255,0.12)",
              background: lowStim ? "#111" : "rgba(244,63,94,0.07)",
            }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-400">
              Energy vs pain (PEM lag, last 30 days)
            </p>
            <p className="mt-1 text-[12px] leading-relaxed">
              {daily.pem.interpretation}
            </p>
            {daily.summary.daysWithLogs > 0 && (
              <p className="mt-1 text-[10px] opacity-60">
                {daily.summary.daysWithLogs} day(s) with pain ·{" "}
                {daily.summary.daysWithActivity} day(s) with logged activity in
                the window.
              </p>
            )}
          </div>
        )}

        <div className="mt-4">
          <ClusterList data={clusters} />
        </div>

        <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3" style={{ borderColor: lowStim ? "#fff" : "rgba(255,255,255,0.12)" }}>
          <span className="text-[11px] opacity-70">
            Full chart: energy drain vs pain, day by day.
          </span>
          <Link
            href="/dashboard"
            className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500"
          >
            Open dashboard →
          </Link>
        </div>
      </div>
    </div>
  );
}
