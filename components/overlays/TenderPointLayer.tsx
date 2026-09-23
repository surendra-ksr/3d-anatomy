"use client";

/**
 * TenderPointLayer - the 18 Fibromyalgia (ACR 1990) tender points rendered as
 * clickable hotspot markers.
 *
 * Marker positions are derived from REAL BodyParts3D mesh bounds (see
 * clinical-overlays.json anchors; e.g. the trapezius point is the midpoint of
 * occiput -> acromion computed from the actual skull & scapula meshes).
 * Clicking a marker records it as "positive" - the ACR criterion counts
 * positive points across the 18 sites (>=11 supports classification, assessed
 * by a clinician).
 */
import { useEffect, useMemo, useState } from "react";
import { Html } from "@react-three/drei";
import * as THREE from "three";

import {
  fetchBoundsMap,
  fetchOverlays,
  resolveAnchor,
  type BoundsMap,
  type OverlaysData,
} from "@/lib/anchors";
import { useAnatomy } from "@/lib/store";

const STORAGE_KEY = "anatomy-engine.tender-points";

export default function TenderPointLayer() {
  const lowStim = useAnatomy((s) => s.lowStim);
  const tenderTally = useAnatomy((s) => s.tenderTally);
  const [data, setData] = useState<OverlaysData | null>(null);
  const [bounds, setBounds] = useState<BoundsMap | null>(null);
  const [positive, setPositive] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchOverlays(), fetchBoundsMap()])
      .then(([overlays, boundsMap]) => {
        if (cancelled) return;
        setData(overlays);
        setBounds(boundsMap);
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored) {
          try {
            setPositive(new Set(JSON.parse(stored) as string[]));
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const markers = useMemo(() => {
    if (!data || !bounds) return [];
    const out: {
      id: string;
      name: string;
      commonName: string;
      side: string;
      fmaId: string;
      position: THREE.Vector3;
    }[] = [];
    for (const tp of data.tenderPoints) {
      const p = resolveAnchor(tp.anchor, bounds);
      if (!p) continue;
      out.push({
        id: tp.id,
        name: tp.name,
        commonName: tp.commonName,
        side: tp.side,
        fmaId: tp.conceptFmaId,
        position: p,
      });
    }
    return out;
  }, [data, bounds]);

  useEffect(() => {
    // report tally to the store (ACR criterion counts)
    const count = positive.size;
    const prev = useAnatomy.getState().tenderTally;
    if ((prev.positive ?? -1) !== count) {
      useAnatomy.setState({ tenderTally: { positive: count } });
    }
  }, [positive]);

  const toggle = (id: string) => {
    setPositive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  return (
    <group name="TENDER_POINTS">
      {markers.map((m) => {
        const isPositive = positive.has(m.id);
        const isOpen = openId === m.id;
        const color = lowStim
          ? "#ffffff"
          : isPositive
            ? "#fb7185"
            : "#fda4af";
        return (
          <group key={m.id} position={m.position}>
            <mesh
              onClick={(e) => {
                e.stopPropagation();
                setOpenId(isOpen ? null : m.id);
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                document.body.style.cursor = "pointer";
              }}
              onPointerOut={() => {
                document.body.style.cursor = "default";
              }}
              renderOrder={7}
            >
              <sphereGeometry args={[0.0075, 16, 14]} />
              <meshStandardMaterial
                color={color}
                emissive={isPositive ? "#f43f5e" : "#64162a"}
                emissiveIntensity={lowStim ? 0 : isPositive ? 0.7 : 0.35}
                roughness={0.4}
              />
            </mesh>
            {/* high-contrast halo ring (visible from any side) */}
            <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={8}>
              <torusGeometry args={[0.012, 0.0012, 8, 32]} />
              <meshBasicMaterial color={lowStim ? "#000000" : "#881337"} />
            </mesh>
            {isOpen && (
              <Html center distanceFactor={0.6} zIndexRange={[50, 40]}>
                <div
                  className="w-56 rounded-md border p-2.5 text-xs shadow-xl"
                  style={{
                    background: lowStim ? "#000" : "#0f172aee",
                    borderColor: lowStim ? "#fff" : "#f43f5e55",
                    color: lowStim ? "#fff" : "#e2e8f0",
                  }}
                >
                  <p className="font-semibold">{m.commonName ?? m.name}</p>
                  <p className="mt-0.5 text-[10px] opacity-70">{m.name}</p>
                  <p className="mt-1 font-mono text-[10px] text-sky-400">
                    {m.fmaId}
                  </p>
                  <button
                    className="mt-2 w-full rounded px-2 py-1 text-[11px] font-medium"
                    style={{
                      background: isPositive
                        ? lowStim
                          ? "#fff"
                          : "#be123c"
                        : lowStim
                          ? "#000"
                          : "#4c0519",
                      color: lowStim && !isPositive ? "#fff" : "#fff",
                      border: lowStim ? "1px solid #fff" : "none",
                    }}
                    onClick={() => toggle(m.id)}
                  >
                    {isPositive ? "✓ Tender (tap to clear)" : "Mark as tender"}
                  </button>
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}
