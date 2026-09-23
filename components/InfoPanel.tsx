"use client";

/**
 * InfoPanel - details of the selected anatomical part, fetched from
 * /api/anatomy/[fmaId] (Next route -> Prisma -> PostgreSQL).
 * Labels respect Low Cognitive Load mode (plain-language aliases).
 */
import { useEffect, useState } from "react";

import { painColor, useAnatomy } from "@/lib/store";
import { useLowStim } from "@/lib/low-stim";
import type { OrganDetailDto } from "@/lib/types";

export default function InfoPanel() {
  const selectedId = useAnatomy((s) => s.selectedId);
  const organById = useAnatomy((s) => s.organById);
  const select = useAnatomy((s) => s.select);
  const painMap = useAnatomy((s) => s.painMap);
  const { lowStim, t } = useLowStim();
  const [detail, setDetail] = useState<OrganDetailDto | null>(null);
  const [loading, setLoading] = useState(false);

  const organ = selectedId != null ? organById.get(selectedId) : null;
  const fmaId = organ?.fmaId;

  useEffect(() => {
    if (!fmaId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/anatomy/${encodeURIComponent(fmaId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: OrganDetailDto) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fmaId]);

  if (!organ) {
    return (
      <aside
        className="hidden w-80 shrink-0 flex-col border-l border-white/10 bg-slate-950/80 p-4 lg:flex"
        style={lowStim ? { borderColor: "#fff" } : undefined}
      >
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Selection
        </h2>
        <p className="mt-3 text-[13px] leading-relaxed text-slate-500">
          Click any structure in the 3D view or in the layer tree. The viewer
          raycasts the pointer into the scene and resolves the FMA concept id
          of the hit mesh.
        </p>
        <div
          className="mt-6 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-[11px] leading-relaxed text-slate-500"
          style={lowStim ? { borderColor: "#fff" } : undefined}
        >
          <p className="font-medium text-slate-400">Try it</p>
          <p className="mt-1">
            Turn on <span className="text-slate-300">Paint pain</span> and click
            a muscle to log today&apos;s pain, or{" "}
            <span className="text-slate-300">Tender points</span> to review the
            18 fibromyalgia sites.
          </p>
        </div>
      </aside>
    );
  }

  const d = detail;
  const pain = painMap.get(organ.id);
  const [pr, pg, pb] = pain ? painColor(pain) : [0, 0, 0];

  return (
    <aside
      className="hidden w-80 shrink-0 flex-col overflow-y-auto border-l border-white/10 bg-slate-950/80 p-4 lg:flex"
      style={lowStim ? { borderColor: "#fff" } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Selection
        </h2>
        <button
          onClick={() => select(null)}
          className="rounded px-1.5 text-slate-500 hover:bg-white/10 hover:text-slate-300"
          aria-label="clear selection"
        >
          ✕
        </button>
      </div>

      <h3 className="mt-2 text-lg font-semibold leading-snug text-slate-100">
        {loading && !d ? "…" : t(organ.name)}
      </h3>
      {lowStim && organ.name !== t(organ.name) && (
        <p className="text-[11px] italic text-slate-400">{organ.name}</p>
      )}

      {d && (
        <>
          <div className="mt-1 flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full ring-1 ring-white/20"
              style={{ backgroundColor: d.system.color }}
            />
            <span className="text-[13px] text-slate-300">{t(d.system.name)}</span>
          </div>

          {pain != null && (
            <div
              className="mt-3 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px]"
              style={{
                background: lowStim ? "#111" : `rgba(${pr * 255},${pg * 255},${pb * 255},0.15)`,
                boxShadow: lowStim ? "inset 0 0 0 1px #fff" : undefined,
              }}
            >
              <span
                className="h-3 w-3 rounded-full"
                style={{ background: `rgb(${pr * 255},${pg * 255},${pb * 255})` }}
              />
              <span className="font-semibold">Pain today: {pain}/10</span>
            </div>
          )}

          <dl className="mt-4 space-y-2 text-[12px]">
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">FMA ID</dt>
              <dd className="font-mono text-sky-400">{d.fmaId}</dd>
            </div>
            {d.bp3dId && (
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">BP3D model</dt>
                <dd className="font-mono text-slate-300">{d.bp3dId}</dd>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Laterality</dt>
              <dd className="text-slate-300">{d.laterality.toLowerCase()}</dd>
            </div>
            {d.parent && (
              <div className="flex justify-between gap-2">
                <dt className="shrink-0 text-slate-500">Part of</dt>
                <dd>
                  <button
                    className="text-right text-sky-400 hover:underline"
                    onClick={() => {
                      const parentId = useAnatomy
                        .getState()
                        .organIdByFmaId.get(d.parent!.fmaId);
                      if (parentId != null) select(parentId);
                    }}
                  >
                    {t(d.parent.name)}
                  </button>
                </dd>
              </div>
            )}
          </dl>

          {d.mesh ? (
            <div
              className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-3"
              style={lowStim ? { borderColor: "#fff" } : undefined}
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Mesh asset
              </p>
              <dl className="mt-2 space-y-1.5 text-[12px]">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Delivery</dt>
                  <dd className="font-mono text-slate-300">{d.mesh.groupKey}.glb</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Node</dt>
                  <dd className="font-mono text-slate-300">{d.mesh.nodePath}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Triangles</dt>
                  <dd className="tabular-nums text-slate-300">
                    {d.mesh.triangleCount.toLocaleString()}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Vertices</dt>
                  <dd className="tabular-nums text-slate-300">
                    {d.mesh.vertexCount.toLocaleString()}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Compression</dt>
                  <dd className="text-slate-300">Google Draco</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Source</dt>
                  <dd className="text-slate-300">{d.mesh.sourceDataset}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <p
              className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-[11px] text-slate-500"
              style={lowStim ? { borderColor: "#fff" } : undefined}
            >
              Taxonomy-only concept — BodyParts3D ships no mesh for this
              structure in this version.
            </p>
          )}

          {d.children.length > 0 && (
            <div className="mt-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Contains ({d.children.length})
              </p>
              <ul className="mt-1.5 space-y-1">
                {d.children.slice(0, 8).map((c) => (
                  <li key={c.fmaId} className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] text-slate-300">{t(c.name)}</span>
                    <span className="font-mono text-[10px] text-slate-600">{c.fmaId}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Ontology references
            </p>
            <ul className="mt-1.5 space-y-1">
              {d.ontologyLinks.map((l) => (
                <li key={l.url}>
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[12px] text-sky-400 hover:underline"
                  >
                    {l.label} ↗
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </aside>
  );
}
