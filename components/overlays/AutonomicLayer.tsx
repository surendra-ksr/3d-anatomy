"use client";

/**
 * AutonomicLayer - schematic visualization of the autonomic nervous system
 * for dysautonomia (ME/CFS).
 *
 * BodyParts3D 3.0 ships no vagus-nerve mesh, so this layer is an explicitly
 * LABELLED schematic: nerve paths are Catmull-Rom tubes threaded through
 * anchor points computed from the real BP3D mesh bounds (brainstem, heart,
 * lungs, stomach, colon, vertebrae, skull base). Every depicted structure
 * keeps its real FMA concept id (see public/data/clinical-overlays.json,
 * validated against FMA.csv by the pipeline).
 *
 * Kinds: parasympathetic (vagus, sky), baroreflex (violet), sympathetic (amber).
 * Pulse animation is disabled in Low Cognitive Load mode.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import {
  fetchBoundsMap,
  fetchOverlays,
  resolveAnchor,
  type BoundsMap,
  type OverlaysData,
} from "@/lib/anchors";
import { useAnatomy } from "@/lib/store";

const KIND_COLORS: Record<string, string> = {
  parasympathetic: "#7dd3fc",
  baroreflex: "#c4b5fd",
  sympathetic: "#fbbf24",
};

function NerveCurve({
  points,
  color,
  radius,
  lowStim,
}: {
  points: THREE.Vector3[];
  color: string;
  radius: number;
  lowStim: boolean;
}) {
  const material = useRef<THREE.MeshStandardMaterial>(null);
  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.35);
    return new THREE.TubeGeometry(curve, Math.max(24, points.length * 10), radius, 7, false);
  }, [points, radius]);

  useFrame(({ clock }) => {
    if (!material.current) return;
    if (!lowStim) {
      // gentle vagal "traffic" pulse (disabled in Low Cognitive Load mode)
      const t = clock.getElapsedTime();
      material.current.emissiveIntensity = 0.35 + 0.25 * Math.sin(t * 2.1);
    } else {
      material.current.emissiveIntensity = 0.35;
    }
  });

  if (!geometry) return null;
  return (
    <mesh geometry={geometry} renderOrder={5}>
      <meshStandardMaterial
        ref={material}
        color={color}
        emissive={color}
        emissiveIntensity={0.35}
        transparent
        opacity={0.92}
        roughness={0.35}
        depthWrite={false}
      />
    </mesh>
  );
}

function NodeMarker({
  position,
  color,
  size,
  lowStim,
}: {
  position: THREE.Vector3;
  color: string;
  size: number;
  lowStim: boolean;
}) {
  return (
    <mesh position={position} renderOrder={6}>
      <sphereGeometry args={[size, 14, 12]} />
      <meshStandardMaterial
        color={lowStim ? "#ffffff" : color}
        emissive={color}
        emissiveIntensity={lowStim ? 0 : 0.5}
        roughness={0.3}
      />
    </mesh>
  );
}

interface BuiltConnection {
  id: string;
  kind: string;
  label: string;
  points: THREE.Vector3[];
}

export default function AutonomicLayer() {
  const lowStim = useAnatomy((s) => s.lowStim);
  const [data, setData] = useState<OverlaysData | null>(null);
  const [bounds, setBounds] = useState<BoundsMap | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchOverlays(), fetchBoundsMap()])
      .then(([overlays, boundsMap]) => {
        if (cancelled) return;
        setData(overlays);
        setBounds(boundsMap);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const built: BuiltConnection[] = useMemo(() => {
    if (!data || !bounds) return [];
    const out: BuiltConnection[] = [];
    for (const conn of data.autonomic.connections) {
      const points: THREE.Vector3[] = [];
      let ok = true;
      for (const via of conn.via) {
        const p = resolveAnchor(via, bounds);
        if (!p) {
          ok = false;
          break;
        }
        points.push(p);
      }
      if (ok && points.length >= 2) {
        out.push({ id: conn.id, kind: conn.kind, label: conn.label, points });
      }
    }
    return out;
  }, [data, bounds]);

  const radius = 0.0032;

  return (
    <group name="ANS_LAYER">
      {built.map(({ id, kind, points }) => (
        <group key={id} name={id}>
          <NerveCurve
            points={points}
            color={lowStim ? "#ffffff" : (KIND_COLORS[kind] ?? "#7dd3fc")}
            radius={radius}
            lowStim={lowStim}
          />
          <NodeMarker
            position={points[0]}
            color={KIND_COLORS[kind] ?? "#7dd3fc"}
            size={0.0045}
            lowStim={lowStim}
          />
          <NodeMarker
            position={points[points.length - 1]}
            color={KIND_COLORS[kind] ?? "#7dd3fc"}
            size={0.006}
            lowStim={lowStim}
          />
        </group>
      ))}
    </group>
  );
}
