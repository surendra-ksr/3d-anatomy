"use client";

/**
 * PainSlider - floating 1-10 intensity panel shown after clicking a mesh in
 * pain-paint mode. Saving upserts a SymptomLog via /api/pain-logs and applies
 * the heatmap color to the 3D material (see AnatomyViewer.useApplyPartStyles).
 */
import { painColor, useAnatomy } from "@/lib/store";
import { useLowStim } from "@/lib/low-stim";

function cssColor([r, g, b]: [number, number, number]) {
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

const LABELS: Record<number, string> = {
  1: "minimal",
  3: "mild",
  5: "moderate",
  7: "strong",
  9: "severe",
  10: "worst imaginable",
};

export default function PainSlider() {
  const draft = useAnatomy((s) => s.painDraft);
  const setValue = useAnatomy((s) => s.setPainDraftValue);
  const save = useAnatomy((s) => s.savePainDraft);
  const close = useAnatomy((s) => s.closePainDraft);
  const clearPain = useAnatomy((s) => s.clearPain);
  const saving = useAnatomy((s) => s.painSaving);
  const { lowStim, t } = useLowStim();

  if (!draft) return null;
  const color = cssColor(painColor(draft.value));
  const label = LABELS[Math.round(draft.value)] ?? "";

  return (
    <div
      className="pointer-events-auto absolute bottom-14 left-1/2 z-20 w-80 -translate-x-1/2 rounded-xl border p-4 shadow-2xl"
      style={{
        background: lowStim ? "#000" : "#0f172af2",
        borderColor: lowStim ? "#fff" : "#ffffff22",
        color: lowStim ? "#fff" : "#e2e8f0",
        borderWidth: lowStim ? 2 : 1,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-semibold">{t(draft.name)}</p>
        <button
          onClick={close}
          className="rounded px-1.5 text-slate-400 hover:text-slate-100"
          aria-label="close"
        >
          ✕
        </button>
      </div>
      <p className="mt-0.5 font-mono text-[10px] text-sky-400">{draft.fmaId}</p>

      <div className="mt-3 flex items-center gap-3">
        <input
          type="range"
          min={1}
          max={10}
          step={1}
          value={Math.round(draft.value)}
          onChange={(e) => setValue(Number(e.target.value))}
          className="h-1.5 w-full"
          style={{ accentColor: color }}
          aria-label="pain intensity 1 to 10"
        />
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold"
          style={{
            background: color,
            color: "#1a0505",
            border: lowStim ? "2px solid #fff" : "none",
          }}
        >
          {Math.round(draft.value)}
        </div>
      </div>
      <p className="mt-1 text-right text-[11px] capitalize opacity-70">{label}</p>

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => void save()}
          disabled={saving}
          className="flex-1 rounded-md py-1.5 text-xs font-semibold disabled:opacity-50"
          style={{
            background: lowStim ? "#fff" : "#0ea5e9",
            color: lowStim ? "#000" : "#fff",
          }}
        >
          {saving ? "Saving…" : "Save pain level"}
        </button>
        <button
          onClick={() => clearPain(draft.organId)}
          className="rounded-md border px-3 py-1.5 text-xs font-medium"
          style={{ borderColor: lowStim ? "#fff" : "#ffffff33" }}
        >
          Remove
        </button>
      </div>
      <p className="mt-2 text-[10px] leading-snug opacity-60">
        Saved to your symptom log (today). Re-painting a structure the same day
        updates its rating.
      </p>
    </div>
  );
}
