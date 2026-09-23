"use client";

/**
 * Central UI state bridging the LayerTree (React DOM) and AnatomyViewer
 * (react-three-fiber canvas).
 *
 * Visibility/opacity are keyed by Organ.id (stable DB identity); the viewer
 * maps fmaId <-> organ id once its GLTF nodes resolve.
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

  // actions
  loadTree: () => Promise<void>;
  setDefaultVisibility: (visibleKeys: string[]) => void;
  toggleOrgan: (organId: number, visible: boolean, cascade?: boolean) => void;
  toggleSystem: (systemKey: string, visible: boolean) => void;
  setOpacity: (organId: number, opacity: number) => void;
  select: (organId: number | null) => void;
  hover: (organId: number | null) => void;
  setIsolate: (isolate: boolean) => void;
  enableGroup: (groupKey: string, enabled: boolean) => void;
  markGroupLoaded: (groupKey: string) => void;
  descendants: (organId: number) => number[];
}

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

  loadTree: async () => {
    try {
      const res = await fetch("/api/anatomy/tree", { cache: "no-store" });
      if (!res.ok) throw new Error(`tree request failed: ${res.status}`);
      const tree = (await res.json()) as AnatomyTreeResponse;
      const { organById, organIdByFmaId } = flattenTree(tree);
      // default view: the viscera (skeletal/muscular layers toggle on demand)
      const DEFAULT_ON = new Set([
        "circulatory",
        "respiratory",
        "digestive",
        "urinary",
        "endocrine",
        "lymphatic",
        "reproductive",
      ]);
      const groupKeys = new Set(tree.systems.flatMap((s) => s.groupKeys));
      set({
        tree,
        treeError: null,
        organById,
        organIdByFmaId,
        enabledGroups: new Set(
          [...groupKeys].filter((g) => DEFAULT_ON.has(g)),
        ),
      });
    } catch (e) {
      set({ treeError: e instanceof Error ? e.message : String(e) });
    }
  },

  setDefaultVisibility: () => {},

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
}));

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
