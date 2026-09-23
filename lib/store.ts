"use client";

/**
 * Central UI state bridging the LayerTree (React DOM) and AnatomyViewer
 * (react-three-fiber canvas).
 *
 * Visibility/opacity are keyed by Organ.id (stable DB identity); the viewer
 * maps fmaId <-> organ id once its GLTF nodes resolve.
 *
 * Clinical extensions (ME/CFS & Fibromyalgia):
 *  - painMap / painMode / painDraft: 3D pain painting + persistence
 *  - ansVisible / tenderVisible: clinical overlay layers
 *  - lowStim: mirror of the Low Cognitive Load provider for canvas-side reads
 */
import { create } from "zustand";

import type { AnatomyTreeResponse, OrganNodeDto, SystemTreeDto } from "@/lib/types";

export interface LoadedPart {
  organId: number;
  fmaId: string;
  name: string;
  systemKey: string;
  groupKey: string;
  nodePath: string;
  visible: boolean;
}

export interface PainDraft {
  organId: number;
  fmaId: string;
  name: string;
  value: number;
}

interface AnatomyState {
  /** Raw tree from the API. */
  tree: AnatomyTreeResponse | null;
  treeError: string | null;
  /** organId -> node, fmaId -> organId */
  organById: Map<number, OrganNodeDto>;
  organIdByFmaId: Map<string, number>;

  /** per-organ visibility (default true until user toggles) */
  hidden: Set<number>;
  /** per-organ opacity override (1 = default) */
  opacity: Map<number, number>;
  /** selected organ id (click in 3D or tree) */
  selectedId: number | null;
  hoveredId: number | null;
  /** isolate mode: show ONLY the selected subtree/branch */
  isolate: boolean;
  /** which GLB groups have been requested for load */
  enabledGroups: Set<string>;
  /** groups that finished loading */
  loadedGroups: Set<string>;

  // --- clinical: pain painting -------------------------------------------
  /** organId -> intensity 1..10 (today's pain map) */
  painMap: Map<number, number>;
  /** fmaId -> intensity (mirror for persistence + meshes without organ rows) */
  painMapByFmaId: Map<string, number>;
  /** when true, clicking a mesh opens the pain slider instead of selecting */
  painMode: boolean;
  painDraft: PainDraft | null;
  painSaving: boolean;

  // --- clinical: overlay layers -------------------------------------------
  ansVisible: boolean;
  tenderVisible: boolean;
  tenderTally: Partial<Record<"none" | "positive", number>>;
  /** mirror of Low Cognitive Load provider state for r3f-side reads */
  lowStim: boolean;

  // --- longitudinal: timeline scrubbing ------------------------------------
  /** ISO date (UTC midnight) -> fmaId -> intensity, loaded history window */
  historyLogs: Map<string, Map<string, number>>;
  /** ISO dates in the window that have at least one log (track dots) */
  historyDays: Set<string>;
  /** scrubber window length in days */
  timelineRange: 7 | 30;
  /** 0 = oldest day of the window … timelineRange-1 = today (live) */
  cursorOffset: number;
  /** playback state for the animated pain-migration view */
  playing: boolean;
  historyLoading: boolean;

  // actions
  loadTree: () => Promise<void>;
  toggleOrgan: (organId: number, visible: boolean, cascade?: boolean) => void;
  toggleSystem: (systemKey: string, visible: boolean) => void;
  setOpacity: (organId: number, opacity: number) => void;
  select: (organId: number | null) => void;
  hover: (organId: number | null) => void;
  setIsolate: (isolate: boolean) => void;
  enableGroup: (groupKey: string, enabled: boolean) => void;
  markGroupLoaded: (groupKey: string) => void;
  descendants: (organId: number) => number[];

  setPainMode: (on: boolean) => void;
  openPainDraft: (part: { organId: number; fmaId: string; name: string }) => void;
  setPainDraftValue: (value: number) => void;
  closePainDraft: () => void;
  savePainDraft: () => Promise<void>;
  clearPain: (organId: number) => Promise<void>;
  clearAllPain: () => Promise<void>;
  hydratePainLogs: () => Promise<void>;

  loadHistory: () => Promise<void>;
  setTimelineRange: (days: 7 | 30) => void;
  setCursorOffset: (offset: number) => void;
  stepCursor: (delta: number) => void;
  setPlaying: (on: boolean) => void;
  jumpToToday: () => void;

  setAnsVisible: (on: boolean) => void;
  setTenderVisible: (on: boolean) => void;
  setLowStim: (on: boolean) => void;
}

/** All dates are UTC-based: both backends key SymptomLog rows by UTC date. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The scrubber window: `range` UTC dates ending today (oldest first). */
export function rangeDates(range: 7 | 30): string[] {
  const out: string[] = [];
  const d = new Date(todayIso());
  d.setUTCDate(d.getUTCDate() - (range - 1));
  for (let i = 0; i < range; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function flattenTree(tree: AnatomyTreeResponse | null) {
  const organById = new Map<number, OrganNodeDto>();
  const organIdByFmaId = new Map<string, number>();
  if (tree) {
    const walk = (nodes: OrganNodeDto[]) => {
      for (const n of nodes) {
        organById.set(n.id, n);
        organIdByFmaId.set(n.fmaId, n.id);
        walk(n.children);
      }
    };
    for (const system of tree.systems) walk(system.roots);
  }
  return { organById, organIdByFmaId };
}

/** 1-10 clinical pain rating -> heatmap color (green -> yellow -> deep red). */
export function painColor(intensity: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [1, [0.29, 0.69, 0.31]],   // green  #4ab050
    [3, [0.96, 0.85, 0.26]],   // yellow #f5da42
    [5, [0.98, 0.58, 0.16]],   // orange #fa9429
    [8, [0.86, 0.15, 0.15]],   // red    #db2626
    [10, [0.55, 0.05, 0.18]],  // crimson deep #8c0d2e
  ];
  const v = Math.min(10, Math.max(1, intensity));
  for (let i = 0; i < stops.length - 1; i++) {
    const [v0, c0] = stops[i];
    const [v1, c1] = stops[i + 1];
    if (v <= v1) {
      const f = (v - v0) / (v1 - v0);
      return [
        c0[0] + f * (c1[0] - c0[0]),
        c0[1] + f * (c1[1] - c0[1]),
        c0[2] + f * (c1[2] - c0[2]),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

const DEFAULT_ON = new Set([
  "circulatory",
  "respiratory",
  "digestive",
  "urinary",
  "endocrine",
  "lymphatic",
  "reproductive",
]);

export const useAnatomy = create<AnatomyState>((set, get) => ({
  tree: null,
  treeError: null,
  organById: new Map(),
  organIdByFmaId: new Map(),

  hidden: new Set(),
  opacity: new Map(),
  selectedId: null,
  hoveredId: null,
  isolate: false,
  enabledGroups: new Set(),
  loadedGroups: new Set(),

  painMap: new Map(),
  painMapByFmaId: new Map(),
  painMode: false,
  painDraft: null,
  painSaving: false,

  ansVisible: false,
  tenderVisible: false,
  tenderTally: {},
  lowStim: false,

  historyLogs: new Map(),
  historyDays: new Set(),
  timelineRange: 7,
  cursorOffset: 6,
  playing: false,
  historyLoading: false,

  loadTree: async () => {
    try {
      const res = await fetch("/api/anatomy/tree", { cache: "no-store" });
      if (!res.ok) throw new Error(`tree request failed: ${res.status}`);
      const tree = (await res.json()) as AnatomyTreeResponse;
      const { organById, organIdByFmaId } = flattenTree(tree);
      const groupKeys = new Set(tree.systems.flatMap((s) => s.groupKeys));
      set({
        tree,
        treeError: null,
        organById,
        organIdByFmaId,
        enabledGroups: new Set([...groupKeys].filter((g) => DEFAULT_ON.has(g))),
      });
    } catch (e) {
      set({ treeError: e instanceof Error ? e.message : String(e) });
    }
  },

  toggleOrgan: (organId, visible, cascade = true) => {
    const { hidden, descendants } = get();
    const next = new Set(hidden);
    if (visible) {
      next.delete(organId);
      if (cascade) for (const d of descendants(organId)) next.delete(d);
    } else {
      next.add(organId);
      if (cascade) for (const d of descendants(organId)) next.add(d);
    }
    set({ hidden: next });
  },

  toggleSystem: (systemKey, visible) => {
    const { tree, hidden, enabledGroups } = get();
    if (!tree) return;
    const system = tree.systems.find((s) => s.key === systemKey);
    if (!system) return;
    const nextHidden = new Set(hidden);
    const nextGroups = new Set(enabledGroups);
    const ids = collectIds(system);
    if (visible) {
      for (const id of ids) nextHidden.delete(id);
      for (const g of system.groupKeys) nextGroups.add(g);
    } else {
      for (const id of ids) nextHidden.add(id);
      for (const g of system.groupKeys) nextGroups.delete(g);
    }
    set({ hidden: nextHidden, enabledGroups: nextGroups });
  },

  setOpacity: (organId, opacity) => {
    const next = new Map(get().opacity);
    if (opacity >= 1) next.delete(organId);
    else next.set(organId, opacity);
    set({ opacity: next });
  },

  select: (organId) => set({ selectedId: organId }),
  hover: (organId) => set({ hoveredId: organId }),
  setIsolate: (isolate) => set({ isolate }),

  enableGroup: (groupKey, enabled) => {
    const next = new Set(get().enabledGroups);
    if (enabled) next.add(groupKey);
    else next.delete(groupKey);
    set({ enabledGroups: next });
  },

  markGroupLoaded: (groupKey) => {
    const next = new Set(get().loadedGroups);
    next.add(groupKey);
    set({ loadedGroups: next });
  },

  descendants: (organId) => {
    const { organById } = get();
    const out: number[] = [];
    const walk = (id: number) => {
      const node = organById.get(id);
      if (!node) return;
      for (const child of node.children) {
        out.push(child.id);
        walk(child.id);
      }
    };
    walk(organId);
    return out;
  },

  setPainMode: (on) => set({ painMode: on, painDraft: null }),

  openPainDraft: ({ organId, fmaId, name }) => {
    const existing = get().painMap.get(organId);
    set({
      painDraft: { organId, fmaId, name, value: existing ?? 5 },
      selectedId: organId,
    });
  },

  setPainDraftValue: (value) => {
    const draft = get().painDraft;
    if (draft) set({ painDraft: { ...draft, value } });
  },

  closePainDraft: () => set({ painDraft: null }),

  savePainDraft: async () => {
    const draft = get().painDraft;
    if (!draft) return;
    set({ painSaving: true });
    try {
      const dates = rangeDates(get().timelineRange);
      const cursorIso =
        get().cursorOffset < dates.length - 1
          ? dates[get().cursorOffset]
          : null; // null = live/today
      const res = await fetch("/api/pain-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: [
            {
              fmaId: draft.fmaId,
              intensity: Math.round(draft.value),
              ...(cursorIso ? { logDate: cursorIso } : {}),
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      const value = Math.round(draft.value);
      if (cursorIso == null) {
        const painMap = new Map(get().painMap);
        const painMapByFmaId = new Map(get().painMapByFmaId);
        painMap.set(draft.organId, value);
        painMapByFmaId.set(draft.fmaId, value);
        set({ painMap, painMapByFmaId, painDraft: null });
      } else {
        set({ painDraft: null });
      }
      // refresh the scrubber cache (cheap; also updates the track dots)
      void get().loadHistory();
    } finally {
      set({ painSaving: false });
    }
  },

  clearPain: async (organId) => {
    const node = get().organById.get(organId);
    const dates = rangeDates(get().timelineRange);
    const cursorIso =
      get().cursorOffset < dates.length - 1 ? dates[get().cursorOffset] : null;
    set({ painDraft: null });
    if (cursorIso) {
      // reviewing a past day: remove the backfilled row server-side
      if (node) {
        await fetch(
          `/api/pain-logs?fmaId=${encodeURIComponent(node.fmaId)}&logDate=${cursorIso}`,
          { method: "DELETE" },
        ).catch(() => undefined);
        void get().loadHistory();
      }
      return;
    }
    if (node && get().painMapByFmaId.has(node.fmaId)) {
      await fetch(`/api/pain-logs?fmaId=${encodeURIComponent(node.fmaId)}`, {
        method: "DELETE",
      }).catch(() => undefined);
    }
    const painMap = new Map(get().painMap);
    const painMapByFmaId = new Map(get().painMapByFmaId);
    painMap.delete(organId);
    if (node) painMapByFmaId.delete(node.fmaId);
    set({ painMap, painMapByFmaId });
  },

  clearAllPain: async () => {
    const dates = rangeDates(get().timelineRange);
    const cursorIso =
      get().cursorOffset < dates.length - 1 ? dates[get().cursorOffset] : null;
    const qs = cursorIso ? `?logDate=${cursorIso}` : "";
    await fetch(`/api/pain-logs${qs}`, { method: "DELETE" });
    if (cursorIso) {
      void get().loadHistory();
    } else {
      set({ painMap: new Map(), painMapByFmaId: new Map(), painDraft: null });
      void get().loadHistory();
    }
  },

  hydratePainLogs: async () => {
    try {
      const res = await fetch(`/api/pain-logs?since=${new Date().toISOString().slice(0, 10)}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        logs: { fmaId: string; intensity: number }[];
      };
      const { organIdByFmaId } = get();
      const painMap = new Map<number, number>();
      const painMapByFmaId = new Map<string, number>();
      for (const log of data.logs) {
        painMapByFmaId.set(log.fmaId, log.intensity);
        const organId = organIdByFmaId.get(log.fmaId);
        if (organId != null) painMap.set(organId, log.intensity);
      }
      set({ painMap, painMapByFmaId });
    } catch {
      // offline-tolerant: local painting still works
    }
  },

  setAnsVisible: (on) => set({ ansVisible: on }),
  setTenderVisible: (on) => set({ tenderVisible: on }),
  setLowStim: (on) => set({ lowStim: on }),

  loadHistory: async () => {
    await loadHistoryImpl(get, set);
  },

  setTimelineRange: (days) => {
    set({ timelineRange: days, cursorOffset: days - 1, playing: false });
    void get().loadHistory();
  },

  setCursorOffset: (offset) => {
    const range = get().timelineRange;
    set({ cursorOffset: Math.min(range - 1, Math.max(0, offset)) });
  },

  stepCursor: (delta) => {
    const { cursorOffset, timelineRange } = get();
    const next = Math.min(timelineRange - 1, Math.max(0, cursorOffset + delta));
    set({ cursorOffset: next });
  },

  setPlaying: (on) => set({ playing: on }),

  jumpToToday: () => set({ cursorOffset: get().timelineRange - 1, playing: false }),
}));

/**
 * Fetch the pain-log history window into historyLogs (fmaId-keyed so the 3D
 * materials can consume it directly) + the set of days that have logs.
 */
async function loadHistoryImpl(
  get: () => AnatomyState,
  set: (partial: Partial<AnatomyState>) => void,
) {
  const range = get().timelineRange;
  const dates = rangeDates(range);
  set({ historyLoading: true });
  try {
    const res = await fetch(
      `/api/pain-logs?from=${dates[0]}&until=${dates[dates.length - 1]}`,
      { cache: "no-store" },
    );
    if (!res.ok) return;
    const data = (await res.json()) as {
      logs: { fmaId: string; intensity: number; logDate: string }[];
    };
    const historyLogs = new Map<string, Map<string, number>>();
    const historyDays = new Set<string>();
    for (const log of data.logs) {
      if (!DATE_RE.test(log.logDate)) continue;
      let day = historyLogs.get(log.logDate);
      if (!day) {
        day = new Map();
        historyLogs.set(log.logDate, day);
      }
      day.set(log.fmaId, log.intensity);
      historyDays.add(log.logDate);
    }
    set({ historyLogs, historyDays });
  } catch {
    // offline-tolerant: timeline simply shows no history
  } finally {
    set({ historyLoading: false });
  }
}

function collectIds(system: SystemTreeDto): number[] {
  const out: number[] = [];
  const walk = (nodes: OrganNodeDto[]) => {
    for (const n of nodes) {
      out.push(n.id);
      walk(n.children);
    }
  };
  walk(system.roots);
  return out;
}

/** Tri-state checkbox state for an organ node. */
export function checkState(
  node: OrganNodeDto,
  hidden: Set<number>,
): "checked" | "unchecked" | "indeterminate" {
  const selfHidden = hidden.has(node.id);
  let anyVisible = !selfHidden;
  let anyHidden = selfHidden;
  const walk = (nodes: OrganNodeDto[]) => {
    for (const n of nodes) {
      if (hidden.has(n.id)) anyHidden = true;
      else anyVisible = true;
      walk(n.children);
    }
  };
  walk(node.children);
  if (anyVisible && anyHidden) return "indeterminate";
  return selfHidden ? "unchecked" : "checked";
}
