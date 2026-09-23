"use client";

/**
 * PacingDialog - Energy Cost (Pacing) Tracker UI.
 *
 * Lets the user select muscle groups, an activity duration and their pacing
 * severity, then calls POST /api/metabolic-cost (FastAPI - documented model
 * from published anthropometry + tissue metabolic rates) and shows the
 * "Energy Drain" score to help avoid post-exertional malaise (PEM).
 */
import { useEffect, useState } from "react";

import { useLowStim } from "@/lib/low-stim";

interface Group {
  fmaId: string;
  name: string;
  commonName: string;
  segment: string;
  referenceMassKg70: number;
}
interface GroupsResponse {
  groups: Group[];
  pacingBudgetsKcal: Record<string, number>;
  defaultSeverity: string;
  disclaimer: string;
}
interface EstimateResponse {
  energyDrain: number;
  riskBand: string;
  advice: string;
  totalKcal: number;
  minutes: number;
  pacingBudgetKcal: number;
  muscles: {
    fmaId: string;
    name: string;
    estimatedMassKg: number;
    kcal: number;
    intensity: number;
  }[];
}

const BAND_COLORS: Record<string, string> = {
  low: "#22c55e",
  moderate: "#eab308",
  high: "#f97316",
  "very high": "#dc2626",
};

export default function PacingDialog({ onClose }: { onClose: () => void }) {
  const { lowStim, t } = useLowStim();
  const [data, setData] = useState<GroupsResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [minutes, setMinutes] = useState(20);
  const [severity, setSeverity] = useState("moderate");
  const [result, setResult] = useState<EstimateResponse | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/py/metabolic-cost/groups")
      .then((r) => r.json())
      .then((d: GroupsResponse) => {
        setData(d);
        setSeverity(d.defaultSeverity);
      })
      .catch(() => undefined);
  }, []);

  const toggle = (fmaId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fmaId)) next.delete(fmaId);
      else next.add(fmaId);
      return next;
    });
  };

  const estimate = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/py/metabolic-cost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fmaIds: [...selected], minutes, severity }),
      });
      if (res.ok) setResult((await res.json()) as EstimateResponse);
    } finally {
      setBusy(false);
    }
  };

  const drain = result?.energyDrain ?? 0;
  const bandColor = result ? BAND_COLORS[result.riskBand] ?? "#eab308" : "#eab308";

  return (
    <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border p-5 shadow-2xl"
        style={{
          background: lowStim ? "#000" : "#0f172af5",
          borderColor: lowStim ? "#fff" : "#ffffff22",
          color: lowStim ? "#fff" : "#e2e8f0",
          borderWidth: lowStim ? 2 : 1,
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Energy cost (pacing) estimator</h2>
            <p className="mt-0.5 text-[11px] opacity-70">
              Theoretical metabolic cost of sustained activity - plan inside
              your envelope to reduce PEM risk.
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

        <fieldset className="mt-4">
          <legend className="text-[11px] font-semibold uppercase tracking-wider opacity-70">
            Muscle groups you will use
          </legend>
          <div className="mt-2 grid max-h-52 grid-cols-1 gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
            {(data?.groups ?? []).map((g) => (
              <label
                key={g.fmaId}
                className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[12px] hover:bg-white/5"
              >
                <input
                  type="checkbox"
                  checked={selected.has(g.fmaId)}
                  onChange={() => toggle(g.fmaId)}
                  className="h-3.5 w-3.5 accent-sky-500"
                />
                <span className="truncate">
                  {t(g.commonName ?? g.name)}
                </span>
                <span className="ml-auto shrink-0 text-[10px] tabular-nums opacity-50">
                  {g.referenceMassKg70.toFixed(1)}kg
                </span>
              </label>
            ))}
            {!data && <p className="animate-pulse text-xs opacity-60">Loading…</p>}
          </div>
        </fieldset>

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="text-[12px]">
            <span className="block text-[11px] font-semibold uppercase tracking-wider opacity-70">
              Duration
            </span>
            <span className="mt-1 flex items-center gap-2">
              <input
                type="range"
                min={2}
                max={120}
                step={2}
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
                className="w-40"
              />
              <span className="w-14 text-right tabular-nums">{minutes} min</span>
            </span>
          </label>
          <label className="text-[12px]">
            <span className="block text-[11px] font-semibold uppercase tracking-wider opacity-70">
              Pacing budget
            </span>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="mt-1 rounded border border-white/20 bg-slate-900 px-2 py-1"
            >
              <option value="mild">mild (120 kcal)</option>
              <option value="moderate">moderate (60 kcal)</option>
              <option value="severe">severe (25 kcal)</option>
            </select>
          </label>
          <button
            onClick={() => void estimate()}
            disabled={busy || selected.size === 0}
            className="ml-auto rounded-md bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-40"
          >
            {busy ? "Estimating…" : "Estimate energy drain"}
          </button>
        </div>

        {result && (
          <div className="mt-5 rounded-lg border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center gap-4">
              <div
                className="flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-full border-4 text-center"
                style={{ borderColor: bandColor }}
                role="status"
                aria-label={`energy drain ${drain} of 100, ${result.riskBand} risk`}
              >
                <span className="text-xl font-bold tabular-nums">{drain}</span>
                <span className="text-[9px] uppercase tracking-wide opacity-70">
                  / 100
                </span>
              </div>
              <div>
                <p
                  className="text-sm font-bold uppercase tracking-wide"
                  style={{ color: bandColor }}
                >
                  {result.riskBand} PEM risk
                </p>
                <p className="mt-0.5 text-[12px] opacity-80">{result.advice}</p>
                <p className="mt-1 text-[11px] opacity-60">
                  {result.totalKcal} kcal muscle cost · {result.minutes} min ·
                  budget {result.pacingBudgetKcal} kcal
                </p>
              </div>
            </div>
            <ul className="mt-3 space-y-1 text-[11px]">
              {result.muscles.map((m) => (
                <li key={m.fmaId} className="flex justify-between gap-2">
                  <span className="truncate opacity-80">{t(m.name)}</span>
                  <span className="shrink-0 tabular-nums opacity-60">
                    {m.kcal} kcal
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-white/10 pt-2 text-[10px] leading-snug opacity-60">
              {data?.disclaimer}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
