"use client";

/**
 * LayerTree - hierarchical layer control beside the 3D canvas.
 *
 * Reads the anatomical hierarchy from the database (via /api/anatomy/tree)
 * and renders a nested checkbox tree, e.g.
 *
 *   [x] Cardiovascular System (FMA7161)
 *     [x] Heart (FMA7088)
 *       [x] Wall of heart (FMA7274)        <- click name: select in 3D
 *
 * Toggling a checkbox writes into the zustand store; AnatomyViewer applies
 * `visible` / `opacity` to the corresponding 3D mesh. Checkboxes cascade to
 * descendants and render a tri-state (checked / unchecked / indeterminate).
 */
import { useEffect, useMemo, useState } from "react";

import { checkState, useAnatomy } from "@/lib/store";
import type { OrganNodeDto } from "@/lib/types";

// ---------------------------------------------------------------------------

function TriCheckbox({
  state,
  onChange,
  color,
}: {
  state: "checked" | "unchecked" | "indeterminate";
  onChange: (next: boolean) => void;
  color?: string;
}) {
  return (
    <input
      type="checkbox"
      checked={state === "checked"}
      ref={(el) => {
        if (el) el.indeterminate = state === "indeterminate";
      }}
      onChange={(e) => onChange(e.target.checked)}
      className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-sky-500"
      style={color ? { accentColor: color } : undefined}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function OrganRow({ node, depth }: { node: OrganNodeDto; depth: number }) {
  const hidden = useAnatomy((s) => s.hidden);
  const toggleOrgan = useAnatomy((s) => s.toggleOrgan);
  const select = useAnatomy((s) => s.select);
  const selectedId = useAnatomy((s) => s.selectedId);
  const hoveredId = useAnatomy((s) => s.hoveredId);
  const hover = useAnatomy((s) => s.hover);
  const opacity = useAnatomy((s) => s.opacity);
  const setOpacity = useAnatomy((s) => s.setOpacity);

  const [open, setOpen] = useState(depth < 2);
  const state = checkState(node, hidden);
  const isSelected = selectedId === node.id;
  const isHovered = hoveredId === node.id;

  return (
    <li role="treeitem" aria-expanded={open} aria-selected={isSelected}>
      <div
        className={`group flex items-center gap-1.5 rounded px-1.5 py-[3px] text-[13px] leading-none transition-colors ${
          isSelected
            ? "bg-sky-500/20 text-sky-100 ring-1 ring-sky-500/40"
            : isHovered
              ? "bg-white/5 text-slate-100"
              : "text-slate-300 hover:bg-white/5"
        }`}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        onMouseEnter={() => hover(node.id)}
        onMouseLeave={() => hover(null)}
        onClick={() => select(node.id)}
      >
        {node.children.length > 0 ? (
          <button
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-white/10 hover:text-slate-200"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
            aria-label={open ? "collapse" : "expand"}
          >
            <svg
              viewBox="0 0 8 8"
              className={`h-2.5 w-2.5 transition-transform ${open ? "rotate-90" : ""}`}
              fill="currentColor"
            >
              <path d="M2 0 L7 4 L2 8 Z" />
            </svg>
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0" />
        )}

        <TriCheckbox
          state={state}
          onChange={(next) => toggleOrgan(node.id, next)}
        />

        <span className={`flex-1 truncate ${node.hasMesh ? "" : "italic text-slate-400"}`}>
          {node.name}
        </span>

        {node.mesh && (
          <span className="shrink-0 text-[10px] tabular-nums text-slate-500 group-hover:hidden">
            {(node.mesh.triangleCount / 1000).toFixed(0)}k△
          </span>
        )}
        {!node.hasMesh && (
          <span className="shrink-0 text-[9px] uppercase tracking-wider text-slate-600">
            taxonomy
          </span>
        )}

        {node.fmaId && (
          <span className="hidden shrink-0 font-mono text-[9px] text-sky-600 group-hover:inline">
            {node.fmaId}
          </span>
        )}
      </div>

      {/* opacity slider for leaf parts with meshes */}
      {node.hasMesh && isSelected && (
        <div
          className="mb-1 flex items-center gap-2 px-2 py-1"
          style={{ paddingLeft: `${depth * 14 + 26}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-[10px] uppercase tracking-wide text-slate-500">
            opacity
          </span>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={opacity.get(node.id) ?? 1}
            onChange={(e) => setOpacity(node.id, Number(e.target.value))}
            className="h-1 w-28 accent-sky-500"
          />
          <span className="w-8 text-right text-[10px] tabular-nums text-slate-400">
            {Math.round((opacity.get(node.id) ?? 1) * 100)}%
          </span>
        </div>
      )}

      {open && node.children.length > 0 && (
        <ul role="group">
          {node.children.map((child) => (
            <OrganRow key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function SystemSection({
  systemKey,
  name,
  color,
  fmaId,
  organCount,
  roots,
  defaultOpen,
}: {
  systemKey: string;
  name: string;
  color: string;
  fmaId: string;
  organCount: number;
  roots: OrganNodeDto[];
  defaultOpen: boolean;
}) {
  const hidden = useAnatomy((s) => s.hidden);
  const toggleSystem = useAnatomy((s) => s.toggleSystem);
  const [open, setOpen] = useState(defaultOpen);

  const state = useMemo(() => {
    let visible = 0;
    let total = 0;
    const walk = (nodes: OrganNodeDto[]) => {
      for (const n of nodes) {
        total += 1;
        if (!hidden.has(n.id)) visible += 1;
        walk(n.children);
      }
    };
    walk(roots);
    if (visible === 0) return "unchecked";
    if (visible === total) return "checked";
    return "indeterminate";
  }, [hidden, roots]);

  return (
    <section className="mb-1">
      <div className="flex items-center gap-2 rounded-md bg-white/[0.04] px-2 py-1.5">
        <button
          className="flex h-4 w-4 items-center justify-center rounded text-slate-500 hover:bg-white/10 hover:text-slate-200"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "collapse system" : "expand system"}
        >
          <svg
            viewBox="0 0 8 8"
            className={`h-2.5 w-2.5 transition-transform ${open ? "rotate-90" : ""}`}
            fill="currentColor"
          >
            <path d="M2 0 L7 4 L2 8 Z" />
          </svg>
        </button>
        <TriCheckbox state={state} onChange={(next) => toggleSystem(systemKey, next)} color={color} />
        <span
          className="h-2 w-2 shrink-0 rounded-full ring-1 ring-white/20"
          style={{ backgroundColor: color }}
        />
        <span className="flex-1 truncate text-[13px] font-medium text-slate-200">
          {name}
        </span>
        <span className="shrink-0 text-[10px] tabular-nums text-slate-500">
          {organCount}
        </span>
        <span className="hidden shrink-0 font-mono text-[9px] text-slate-600 md:inline">
          {fmaId}
        </span>
      </div>

      {open && (
        <ul role="group" className="mt-0.5">
          {roots.map((root) => (
            <OrganRow key={root.id} node={root} depth={1} />
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

export default function LayerTree() {
  const tree = useAnatomy((s) => s.tree);
  const treeError = useAnatomy((s) => s.treeError);
  const loadTree = useAnatomy((s) => s.loadTree);
  const [query, setQuery] = useState("");

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  const systems = tree?.systems ?? [];
  const visibleSystems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return systems;
    return systems
      .map((s) => {
        if (s.name.toLowerCase().includes(q)) return s;
        const matches = (nodes: typeof s.roots): typeof s.roots =>
          nodes
            .map((n) => {
              const kids = matches(n.children);
              if (n.name.toLowerCase().includes(q) || kids.length > 0) {
                return { ...n, children: kids };
              }
              return null;
            })
            .filter((x): x is (typeof s.roots)[number] => x !== null);
        const roots = matches(s.roots);
        return roots.length > 0 ? { ...s, roots } : null;
      })
      .filter((x): x is (typeof systems)[number] => x !== null);
  }, [systems, query]);

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-r border-white/10 bg-slate-950/80">
      <div className="border-b border-white/10 px-3 py-3">
        <h1 className="text-sm font-semibold tracking-tight text-slate-100">
          Interactive Anatomy Engine
        </h1>
        <p className="mt-0.5 text-[11px] text-slate-500">
          BodyParts3D (DBCLS) → FMA ontology · Draco compressed
        </p>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter structures…"
          className="mt-2.5 w-full rounded-md border border-white/10 bg-slate-900 px-2.5 py-1.5 text-[13px] text-slate-200 placeholder:text-slate-600 focus:border-sky-500/60 focus:outline-none"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2" role="tree">
        {treeError && (
          <p className="m-2 rounded bg-red-950/70 px-2 py-1.5 text-xs text-red-300">
            {treeError}
          </p>
        )}
        {!tree && !treeError && (
          <p className="m-2 animate-pulse text-xs text-slate-500">
            Loading anatomical hierarchy…
          </p>
        )}
        {visibleSystems.map((system, i) => (
          <SystemSection
            key={system.key}
            systemKey={system.key}
            name={system.name}
            color={system.color}
            fmaId={system.fmaId}
            organCount={system.organCount}
            roots={system.roots}
            defaultOpen={i < 3}
          />
        ))}
      </div>

      <div className="border-t border-white/10 px-3 py-2 text-[10px] leading-relaxed text-slate-600">
        {tree?.meta.dataset} v{tree?.meta.datasetVersion} · {tree?.meta.license} ·{" "}
        {tree?.meta.rightsHolder}
      </div>
    </aside>
  );
}
