"use client";

/**
 * TimelineBar - time-scrubbing controls for the temporal heatmap (bottom of
 * the 3D viewer). Scrubbing (or playing) moves the cursor through the
 * selected window; AnatomyViewer re-tints the meshes from that day's
 * SymptomLog rows, animating how pain migrates across the body.
 *
 * Days with logged pain show as amber ticks on the track. When the cursor
 * sits on a past day, painting pain backfills that day's log; the live map
 * is untouched. Playback anim is intentionally still available in Low
 * Cognitive Load mode (user-initiated, slow) but the tick uses a longer
 * interval there.
 */
import { useEffect } from "react";

import { rangeDates, useAnatomy } from "@/lib/store";
import { useLowStim } from "@/lib/low-stim";

function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function TimelineBar() {
  const timelineRange = useAnatomy((s) => s.timelineRange);
  const cursorOffset = useAnatomy((s) => s.cursorOffset);
  const playing = useAnatomy((s) => s.playing);
  const historyDays = useAnatomy((s) => s.historyDays);
  const historyLoading = useAnatomy((s) => s.historyLoading);
  const setTimelineRange = useAnatomy((s) => s.setTimelineRange);
  const setCursorOffset = useAnatomy((s) => s.setCursorOffset);
  const stepCursor = useAnatomy((s) => s.stepCursor);
  const setPlaying = useAnatomy((s) => s.setPlaying);
  const jumpToToday = useAnatomy((s) => s.jumpToToday);
  const { lowStim, t } = useLowStim();

  const dates = rangeDates(timelineRange);
  const cursorIso = dates[Math.min(cursorOffset, dates.length - 1)];
  const isToday = cursorOffset >= dates.length - 1;

  // playback: step day by day, stop at today
  useEffect(() => {
    if (!playing) return;
    const interval = window.setInterval(
      () => {
        const s = useAnatomy.getState();
        if (s.cursorOffset >= s.timelineRange - 1) {
          s.setPlaying(false);
        } else {
          s.setCursorOffset(s.cursorOffset + 1);
        }
      },
      lowStim ? 1400 : 700,
    );
    return () => window.clearInterval(interval);
  }, [playing, lowStim]);

  const btnStyle = {
    borderColor: lowStim ? "#fff" : "rgba(255,255,255,0.14)",
  } as const;

  return (
    <div
      className="pointer-events-auto absolute bottom-3 left-1/2 z-10 w-[min(620px,calc(100%-2rem))] -translate-x-1/2 rounded-xl border p-2.5 shadow-xl backdrop-blur"
      style={{
        background: lowStim ? "#000" : "rgba(2,6,23,0.82)",
        borderColor: lowStim ? "#fff" : "rgba(255,255,255,0.14)",
        borderWidth: lowStim ? 2 : 1,
        color: lowStim ? "#fff" : "#e2e8f0",
      }}
    >
      <div className="flex items-center gap-2">
        <button
          onClick={() => setPlaying(!playing)}
          disabled={isToday && !playing}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold disabled:opacity-35"
          style={{
            background: playing ? "#e11d48" : "#0ea5e9",
            color: "#fff",
            border: lowStim ? "1px solid #fff" : "none",
          }}
          aria-label={playing ? "pause pain history playback" : "play pain history"}
          title="Play through the window"
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <button
          onClick={() => {
            setPlaying(false);
            stepCursor(-1);
          }}
          disabled={cursorOffset <= 0}
          className="h-7 shrink-0 rounded-md border px-2 text-xs disabled:opacity-35"
          style={btnStyle}
          aria-label="previous day"
        >
          ◀
        </button>
        <button
          onClick={() => {
            setPlaying(false);
            stepCursor(1);
          }}
          disabled={isToday}
          className="h-7 shrink-0 rounded-md border px-2 text-xs disabled:opacity-35"
          style={btnStyle}
          aria-label="next day"
        >
          ▶
        </button>

        <div className="min-w-0 flex-1 text-center leading-tight">
          <div className="truncate text-[12px] font-semibold">
            {isToday ? t("Today") : t("Viewing")} · {dayLabel(cursorIso)}
          </div>
          <div className="truncate text-[9px] opacity-60">
            {isToday
              ? historyDays.has(cursorIso)
                ? "live pain map"
                : "live pain map — no logs yet today"
              : "scrubbing history — paint to backfill this day"}
          </div>
        </div>

        <div className="flex shrink-0 overflow-hidden rounded-md border text-[11px]" style={btnStyle}>
          {([7, 30] as const).map((r) => (
            <button
              key={r}
              onClick={() => setTimelineRange(r)}
              className="px-2 py-1"
              style={{
                background:
                  timelineRange === r ? (lowStim ? "#fff" : "#0ea5e9") : "transparent",
                color:
                  timelineRange === r
                    ? lowStim
                      ? "#000"
                      : "#fff"
                    : "inherit",
                fontWeight: timelineRange === r ? 700 : 400,
              }}
              aria-pressed={timelineRange === r}
            >
              {r}D
            </button>
          ))}
        </div>

        {!isToday && (
          <button
            onClick={jumpToToday}
            className="shrink-0 rounded-md border px-2 py-1 text-[11px]"
            style={btnStyle}
          >
            {t("Back to today")}
          </button>
        )}
      </div>

      <div className="relative mt-2 px-0.5">
        {/* day ticks: amber when that day has logs */}
        <div className="pointer-events-none absolute inset-x-1 top-1/2 flex -translate-y-1/2 justify-between">
          {dates.map((iso) => (
            <span
              key={iso}
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: historyDays.has(iso)
                  ? "#fbbf24"
                  : lowStim
                    ? "#555"
                    : "rgba(148,163,184,0.25)",
              }}
              title={`${iso}${historyDays.has(iso) ? " — has logs" : ""}`}
            />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={dates.length - 1}
          step={1}
          value={cursorOffset}
          onChange={(e) => {
            setPlaying(false);
            setCursorOffset(Number(e.target.value));
          }}
          className="relative w-full"
          style={{ accentColor: lowStim ? "#ffffff" : "#0ea5e9", height: "1.1rem" }}
          aria-label="scrub through days"
        />
      </div>
      {historyLoading && (
        <div className="absolute right-3 top-2 text-[9px] opacity-50">
          syncing…
        </div>
      )}
    </div>
  );
}
