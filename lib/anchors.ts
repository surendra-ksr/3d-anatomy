/**
 * Shared math for clinical overlay anchors.
 *
 * Anchors are expressed against the REAL BodyParts3D mesh bounds emitted by
 * the pipeline (manifest.meshAssets[].boundsBp3dMm, in BP3D millimetres:
 * +X = left, +Y = posterior, +Z = superior). Conversion to the glTF world
 * the viewer uses (metres, Y-up) mirrors the BP3D_ROOT node transform:
 *   world = (x, z, -y) * 0.001
 */
import * as THREE from "three";

export interface AnchorEndpoint {
  fmaId: string;
  frac: [number, number, number];
}
export interface AnchorSpec {
  a: AnchorEndpoint;
  b?: AnchorEndpoint;
  /** blend factor a -> b (default 0) */
  t?: number;
}

export type BoundsMap = Map<string, { min: [number, number, number]; max: [number, number, number] }>;

export function bp3dToWorld(p: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(p[0] * 0.001, p[2] * 0.001, -p[1] * 0.001);
}

/** Evaluate an anchor spec against the real mesh bounds. Returns null when a
 *  referenced part has no bounds (e.g. its group is not in the dataset). */
export function resolveAnchor(
  spec: AnchorSpec,
  bounds: BoundsMap,
): THREE.Vector3 | null {
  const evalEndpoint = (ep: AnchorEndpoint): THREE.Vector3 | null => {
    const b = bounds.get(ep.fmaId);
    if (!b) return null;
    const p: [number, number, number] = [
      b.min[0] + ep.frac[0] * (b.max[0] - b.min[0]),
      b.min[1] + ep.frac[1] * (b.max[1] - b.min[1]),
      b.min[2] + ep.frac[2] * (b.max[2] - b.min[2]),
    ];
    return bp3dToWorld(p);
  };
  const a = evalEndpoint(spec.a);
  if (!a) return null;
  if (!spec.b) return a;
  const bPoint = evalEndpoint(spec.b);
  if (!bPoint) return null;
  const t = spec.t ?? 0.5;
  return a.lerp(bPoint, t);
}

/** Fetch + cache the pipeline manifest (mesh bounds etc.). */
let manifestCache: Promise<{
  meshAssets: { fmaId: string; boundsBp3dMm?: { min: number[]; max: number[] } }[];
}> | null = null;

export function fetchManifest() {
  if (!manifestCache) {
    manifestCache = fetch("/models/manifest.json").then((r) => {
      if (!r.ok) throw new Error(`manifest ${r.status}`);
      return r.json();
    });
  }
  return manifestCache;
}

/** Bounds map from the manifest. */
export async function fetchBoundsMap(): Promise<BoundsMap> {
  const manifest = await fetchManifest();
  const map: BoundsMap = new Map();
  for (const asset of manifest.meshAssets) {
    if (asset.boundsBp3dMm) {
      map.set(asset.fmaId, {
        min: asset.boundsBp3dMm.min as [number, number, number],
        max: asset.boundsBp3dMm.max as [number, number, number],
      });
    }
  }
  return map;
}

export interface OverlaysData {
  autonomic: {
    label: string;
    commonLabel: string;
    description: string;
    nodes: {
      id: string;
      fmaId: string;
      name: string;
      commonName: string;
      schematic: boolean;
      meshFmaId?: string;
    }[];
    connections: {
      id: string;
      label: string;
      kind: "parasympathetic" | "sympathetic" | "baroreflex";
      conceptFmaIds: string[];
      via: AnchorSpec[];
    }[];
  };
  tenderPoints: {
    id: string;
    pair: string;
    side: "LEFT" | "RIGHT";
    name: string;
    commonName: string;
    conceptFmaId: string;
    anchor: AnchorSpec;
  }[];
}

let overlaysCache: Promise<OverlaysData> | null = null;

export function fetchOverlays() {
  if (!overlaysCache) {
    overlaysCache = fetch("/data/clinical-overlays.json").then((r) => {
      if (!r.ok) throw new Error(`clinical-overlays ${r.status}`);
      return r.json();
    });
  }
  return overlaysCache;
}
