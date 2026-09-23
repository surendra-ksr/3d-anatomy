"use client";

/**
 * InfoPanel - details of the selected anatomical part, fetched from
 * /api/anatomy/[fmaId] (Next route -> Prisma -> PostgreSQL).
 */
import { useEffect, useState } from "react";

import { useAnatomy } from "@/lib/store";
import type { OrganDetailDto } from "@/lib/types";

export default function InfoPanel() {
  const selectedId = useAnatomy((s) => s.selectedId);
  const organById = useAnatomy((s) => s.organById);
  const select = useAnatomy((s) => s.select);
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
      <aside className="hidden w-80 shrink-0 flex-col border-l border-white/10 bg-slate-950/80 p-4 lg:flex">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Selection
        </h2>
        <p className="mt-3 text-[13px] leading-relaxed text-slate-500">
          Click any structure in the 3D view or in the layer tree. The viewer
          raycasts the pointer into the scene and resolves the FMA concept id
          of the hit mesh.
        </p>
        <div className="mt-6 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-[11px] leading-relaxed text-slate-500">
          <p className="font-medium text-slate-400">Try it</p>
          <p className="mt-1">
            Enable <span className="text-slate-300">Cardiovascular System</span>{" "}
            and click the heart — selection isolates FMA:7274{" "}
            <em>(wall of heart)</em>, child of FMA:7088{" "}
            <em>(heart)</em> in the Foundational Model of Anatomy.
          </p>
        </div>
      </aside>
    );
  }

  const d = detail;

  return (
    <aside className="hidden w-80 shrink-0 flex-col overflow-y-auto border-l border-white/10 bg-slate-950/80 p-4 lg:flex">
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
        {loading && !d ? "…" : organ.name}
      </h3>

      {d && (
        <>
          <div className="mt-1 flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full ring-1 ring-white/20"
              style={{ backgroundColor: d.system.color }}
            />
            <span className="text-[13px] text-slate-300">{d.system.name}</span>
          </div>

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
                    {d.parent.name}
                  </button>
                </dd>
              </div>
            )}
          </dl>

          {d.mesh ? (
            <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-3">
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
            <p className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-[11px] text-slate-500">
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
                    <span className="truncate text-[12px] text-slate-300">{c.name}</span>
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
