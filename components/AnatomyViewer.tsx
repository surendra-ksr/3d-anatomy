"use client";

/**
 * AnatomyViewer - the react-three-fiber 3D canvas.
 *
 * Responsibilities
 *  - loads the Draco-compressed BodyParts3D GLB groups with useGLTF
 *  - explicit raycasting for click-to-select: every pointer event is turned
 *    into a normalized device coordinate, a Raycaster is cast against the
 *    loaded anatomy meshes, and the first hit's glTF `extras.fmaId` (written
 *    by the data pipeline) is isolated into the selection
 *  - medical-grade lighting: soft ambient fill + warm key light + cool
 *    directional rim light for depth separation
 *  - OrbitControls for rotate / pan / zoom with damping
 *  - visibility + opacity of every part is driven by the zustand store, which
 *    the LayerTree component writes to
 */
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF, useProgress } from "@react-three/drei";
import * as THREE from "three";

import { useAnatomy } from "@/lib/store";
import type { GroupDto } from "@/lib/types";

// ---------------------------------------------------------------------------
// shared mesh registry
// ---------------------------------------------------------------------------

export interface RegisteredMesh {
  mesh: THREE.Mesh;
  organId: number;
  fmaId: string;
  name: string;
  systemKey: string;
  groupKey: string;
}
export type MeshRegistry = Map<string, RegisteredMesh>; // key: fmaId

// ---------------------------------------------------------------------------
// raycasting
// ---------------------------------------------------------------------------

interface HitInfo {
  organId: number;
  fmaId: string;
  name: string;
  systemKey: string;
  screen: { x: number; y: number };
}

/** pointer -> NDC -> raycast -> first anatomy hit */
function useAnatomyRaycaster(
  registry: MeshRegistry,
  onHover: (hit: HitInfo | null) => void,
  onSelect: (hit: HitInfo | null) => void,
) {
  const { camera, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const pointer = useMemo(() => new THREE.Vector2(), []);
  const state = useRef({
    downX: 0,
    downY: 0,
    downTime: 0,
    dragging: false,
  });

  const pick = useCallback(
    (clientX: number, clientY: number): HitInfo | null => {
      const rect = gl.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const targets: THREE.Mesh[] = [];
      for (const entry of registry.values()) {
        if (entry.mesh.visible) targets.push(entry.mesh);
      }
      const hits = raycaster.intersectObjects(targets, false);
      const hit = hits[0];
      if (!hit) return null;
      const mesh = hit.object as THREE.Mesh;
      // walk up in case the mesh sits under a group whose userData carries
      // the pipeline extras
      let node: THREE.Object3D | null = mesh;
      let extras: Record<string, unknown> | undefined;
      while (node && !extras) {
        extras = node.userData?.extras ?? node.userData;
        if (extras && !("fmaId" in extras)) extras = undefined;
        node = node.parent;
      }
      const fmaId = String(extras?.fmaId ?? mesh.name ?? "");
      if (!fmaId) return null;
      return {
        organId: Number(extras?.organId ?? 0),
        fmaId,
        name: String(extras?.name ?? fmaId),
        systemKey: String(extras?.systemKey ?? ""),
        screen: { x: clientX - rect.left, y: clientY - rect.top },
      };
    },
    [camera, gl, pointer, raycaster, registry],
  );

  useEffect(() => {
    const el = gl.domElement;

    const onPointerDown = (e: PointerEvent) => {
      state.current.downX = e.clientX;
      state.current.downY = e.clientY;
      state.current.downTime = performance.now();
      state.current.dragging = true;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (state.current.dragging) {
        const dx = e.clientX - state.current.downX;
        const dy = e.clientY - state.current.downY;
        if (dx * dx + dy * dy > 25) {
          state.current.dragging = false; // orbit gesture, not a click
          onHover(pick(e.clientX, e.clientY));
        }
        return;
      }
      onHover(pick(e.clientX, e.clientY));
    };

    const onPointerUp = (e: PointerEvent) => {
      const wasClick =
        state.current.dragging &&
        performance.now() - state.current.downTime < 600 &&
        Math.hypot(e.clientX - state.current.downX, e.clientY - state.current.downY) < 6;
      state.current.dragging = false;
      if (wasClick) {
        const hit = pick(e.clientX, e.clientY);
        onSelect(hit);
      }
    };

    const onPointerLeave = () => {
      state.current.dragging = false;
      onHover(null);
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointerleave", onPointerLeave);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointerleave", onPointerLeave);
    };
  }, [gl, onHover, onSelect, pick]);

  return pick;
}

// ---------------------------------------------------------------------------
// lighting rig (medical viewing: neutral ambient fill, key + rim directional)
// ---------------------------------------------------------------------------

function LightingRig() {
  return (
    <>
      {/* soft neutral fill so concavities never go fully black */}
      <ambientLight intensity={0.42} />
      {/* gentle sky/ground bounce for volume cues */}
      <hemisphereLight args={["#dfe9f3", "#3a3a41", 0.35]} />
      {/* warm key light, upper-left of the viewer */}
      <directionalLight position={[2.5, 3.2, 2.0]} intensity={1.25} color="#fff4e6" />
      {/* cool rim light from behind for silhouette depth */}
      <directionalLight position={[-2.0, 1.6, -2.8]} intensity={1.6} color="#bcd6ff" />
      {/* low fill from the feet to lift the lower body out of shadow */}
      <directionalLight position={[0.5, -2.2, 1.2]} intensity={0.25} color="#e8e8ea" />
    </>
  );
}

// ---------------------------------------------------------------------------
// one GLB delivery group
// ---------------------------------------------------------------------------

function ModelGroup({
  group,
  registry,
  onFirstLoad,
}: {
  group: GroupDto;
  registry: MeshRegistry;
  onFirstLoad: () => void;
}) {
  const { scene } = useGLTF(group.url, "/draco/");
  const markLoaded = useAnatomy((s) => s.markGroupLoaded);
  const registered = useRef(false);

  useEffect(() => {
    if (registered.current) return;
    registered.current = true;

    scene.updateMatrixWorld(true);
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;

      const node = obj as THREE.Object3D & {
        userData: { fmaId?: string; name?: string; systemKey?: string };
      };
      const fmaId = node.userData.fmaId ?? mesh.name;
      const organIdFromStore = useAnatomy.getState().organIdByFmaId.get(fmaId ?? "");

      // per-part material instance (highlight/opacity are per organ)
      const prev = mesh.material as THREE.MeshStandardMaterial;
      const mat = new THREE.MeshStandardMaterial({
        color: prev?.color?.clone() ?? new THREE.Color(0.85, 0.82, 0.75),
        roughness: prev?.roughness ?? 0.6,
        metalness: prev?.metalness ?? 0.0,
        side: THREE.FrontSide,
        flatShading: false,
      });
      mesh.material = mat;
      // dispose the shared original
      prev?.dispose?.();

      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = true;

      if (fmaId) {
        node.userData.extras = {
          ...node.userData,
          fmaId,
          name: node.userData.name ?? fmaId,
          systemKey: node.userData.systemKey ?? group.systemKey,
          organId: organIdFromStore ?? 0,
        };
        // build the node hierarchy path for debugging/lookup
        node.userData.nodePath = node.name;
        registry.set(fmaId, {
          mesh,
          organId: organIdFromStore ?? 0,
          fmaId,
          name: node.userData.name ?? fmaId,
          systemKey: node.userData.systemKey ?? group.systemKey,
          groupKey: group.key,
        });
      }
    });

    markLoaded(group.key);
    onFirstLoad();
    // NOTE: no disposal on unmount - useGLTF caches scenes module-wide and
    // groups toggle on/off frequently; re-registering is cheap, rebuilding
    // GPU buffers is not.
  }, [scene, registry, group.key, group.systemKey, markLoaded, onFirstLoad]);

  return <primitive object={scene} />;
}

// ---------------------------------------------------------------------------
// applies store visibility / opacity / highlight to the registered meshes
// ---------------------------------------------------------------------------

function useApplyPartStyles(registry: MeshRegistry) {
  const hidden = useAnatomy((s) => s.hidden);
  const opacity = useAnatomy((s) => s.opacity);
  const selectedId = useAnatomy((s) => s.selectedId);
  const hoveredId = useAnatomy((s) => s.hoveredId);
  const isolate = useAnatomy((s) => s.isolate);
  const organById = useAnatomy((s) => s.organById);

  useEffect(() => {
    const SELECTED_EMISSIVE = new THREE.Color("#ff8a3c");
    const HOVER_EMISSIVE = new THREE.Color("#69b7ff");

    // precompute the visible id set in isolate mode (selected subtree only)
    let isolateIds: Set<number> | null = null;
    if (isolate && selectedId != null) {
      isolateIds = new Set<number>([selectedId]);
      const stack = [...(organById.get(selectedId)?.children ?? [])];
      while (stack.length) {
        const node = stack.pop()!;
        isolateIds.add(node.id);
        stack.push(...node.children);
      }
    }

    for (const { mesh, organId } of registry.values()) {
      let visible = !hidden.has(organId);
      if (isolateIds) visible = visible && isolateIds.has(organId);

      const opa = opacity.get(organId) ?? 1;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.transparent = opa < 1;
      mat.opacity = opa;
      mat.depthWrite = opa >= 1;

      const isSelected = selectedId === organId;
      const isHovered = hoveredId === organId && !isSelected;
      mat.emissive = isSelected
        ? SELECTED_EMISSIVE
        : isHovered
          ? HOVER_EMISSIVE
          : new THREE.Color(0x000000);
      mat.emissiveIntensity = isSelected ? 0.5 : isHovered ? 0.22 : 0;
      mat.needsUpdate = true;

      mesh.visible = visible;
    }
  }, [registry, hidden, opacity, selectedId, hoveredId, isolate, organById]);
}

// ---------------------------------------------------------------------------
// camera framing: center the orbit target on the loaded anatomy
// ---------------------------------------------------------------------------

function CameraRig({
  registry,
  trigger,
  controlsRef,
}: {
  registry: MeshRegistry;
  trigger: number;
  controlsRef: React.RefObject<any>;
}) {
  const { camera } = useThree();
  useEffect(() => {
    if (trigger === 0 || registry.size === 0) return;
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    for (const { mesh } of registry.values()) {
      tmp.setFromObject(mesh);
      box.union(tmp);
    }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim * 1.15;

    const controls = controlsRef.current;
    if (controls) {
      controls.target.copy(center);
      controls.update();
    }
    camera.position.set(center.x + dist * 0.12, center.y - dist * 0.12, center.z + dist);
    camera.near = Math.max(maxDim / 1000, 0.005);
    camera.far = Math.max(maxDim * 20, 60);
    camera.updateProjectionMatrix();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);
  return null;
}

// ---------------------------------------------------------------------------
// scene contents
// ---------------------------------------------------------------------------

function SceneContents({
  registry,
  controlsRef,
}: {
  registry: MeshRegistry;
  controlsRef: React.RefObject<any>;
}) {
  const enabledGroups = useAnatomy((s) => s.enabledGroups);
  const select = useAnatomy((s) => s.select);
  const hover = useAnatomy((s) => s.hover);
  const [frameTrigger, setFrameTrigger] = useState(0);
  const framedOnce = useRef(false);

  const onHover = useCallback(
    (hit: HitInfo | null) => {
      if (!hit) {
        hover(null);
        return;
      }
      hover(hit.organId || null);
    },
    [hover],
  );

  const onSelect = useCallback(
    (hit: HitInfo | null) => {
      if (!hit) {
        select(null);
        return;
      }
      select(hit.organId || null);
    },
    [select],
  );

  useAnatomyRaycaster(registry, onHover, onSelect);
  useApplyPartStyles(registry);

  // group metadata (labels, urls) ships with the pipeline manifest; the tree
  // endpoint exposes which groups exist per system.
  const [groupTable, setGroupTable] = useState<GroupDto[]>([]);
  useEffect(() => {
    fetch("/models/manifest.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((m: { groups: GroupDto[] }) => setGroupTable(m.groups))
      .catch(() => setGroupTable([]));
  }, []);

  const onFirstLoad = useCallback(() => {
    if (framedOnce.current) return;
    framedOnce.current = true;
    // wait a tick so meshes register
    setTimeout(() => setFrameTrigger((t) => t + 1), 60);
  }, []);

  const enabled = groupTable.filter((g) => enabledGroups.has(g.key));

  return (
    <>
      <LightingRig />
      <Suspense fallback={null}>
        {enabled.map((group) => (
          <ModelGroup
            key={group.key}
            group={group}
            registry={registry}
            onFirstLoad={onFirstLoad}
          />
        ))}
      </Suspense>
      <CameraRig registry={registry} trigger={frameTrigger} controlsRef={controlsRef} />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        screenSpacePanning
        minDistance={0.05}
        maxDistance={12}
        zoomSpeed={0.9}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// overlay (progress + hover tooltip + isolate bar)
// ---------------------------------------------------------------------------

function LoadingOverlay() {
  const { active, progress } = useProgress();
  const treeError = useAnatomy((s) => s.treeError);
  if (treeError) {
    return (
      <div className="pointer-events-auto absolute inset-x-0 top-4 mx-auto w-fit rounded-md bg-red-950/90 px-4 py-2 text-sm text-red-200 shadow-lg">
        Failed to load anatomy data: {treeError}
      </div>
    );
  }
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 top-0 flex items-center justify-center bg-slate-950/40">
      <div className="w-64 rounded-lg bg-slate-900/90 px-5 py-4 text-slate-200 shadow-2xl">
        <div className="mb-2 text-xs font-medium tracking-wide text-slate-400">
          LOADING BODYPARTS3D MESHES (DRACO)
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
          <div
            className="h-full rounded-full bg-sky-500 transition-[width] duration-200"
            style={{ width: `${progress.toFixed(0)}%` }}
          />
        </div>
        <div className="mt-2 text-right text-xs text-slate-400">
          {progress.toFixed(0)}%
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// root component
// ---------------------------------------------------------------------------

export default function AnatomyViewer() {
  const registry: MeshRegistry = useMemo(() => new Map(), []);
  const controlsRef = useRef<any>(null);
  const hovered = useAnatomy((s) => s.hoveredId);
  const organById = useAnatomy((s) => s.organById);
  const isolate = useAnatomy((s) => s.isolate);
  const setIsolate = useAnatomy((s) => s.setIsolate);
  const select = useAnatomy((s) => s.select);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => setMouse({ x: e.clientX, y: e.clientY });
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  const hoveredName = hovered != null ? organById.get(hovered)?.name : null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-[radial-gradient(ellipse_at_50%_20%,#1c2434_0%,#0b0f17_70%)]">
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0.25, 0.1, 1.9], fov: 42, near: 0.01, far: 60 }}
        gl={{ antialias: true, alpha: false }}
        onPointerMissed={() => select(null)}
        style={{ cursor: hoveredName ? "pointer" : "default" }}
      >
        <color attach="background" args={["#0d1117"]} />
        <SceneContents registry={registry} controlsRef={controlsRef} />
      </Canvas>

      <LoadingOverlay />

      {hoveredName && mouse && (
        <div
          className="pointer-events-none absolute z-10 rounded bg-slate-900/90 px-2.5 py-1.5 text-xs text-slate-100 shadow-lg ring-1 ring-white/10"
          style={{ left: mouse.x + 14, top: mouse.y + 14 }}
        >
          {hoveredName}
        </div>
      )}

      <div className="pointer-events-auto absolute bottom-3 right-3 flex items-center gap-2">
        <button
          onClick={() => setIsolate(!isolate)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium shadow ring-1 transition ${
            isolate
              ? "bg-orange-500 text-white ring-orange-400"
              : "bg-slate-900/85 text-slate-300 ring-white/10 hover:bg-slate-800"
          }`}
          title="Show only the selected structure (and its children)"
        >
          {isolate ? "Isolate: ON" : "Isolate selection"}
        </button>
        <button
          onClick={() => controlsRef.current?.reset?.()}
          className="rounded-md bg-slate-900/85 px-3 py-1.5 text-xs font-medium text-slate-300 shadow ring-1 ring-white/10 hover:bg-slate-800"
        >
          Reset camera
        </button>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 text-[10px] leading-tight text-slate-500">
        Meshes: BodyParts3D v3.0 · DBCLS · CC BY-SA 2.1 JP — mapped to FMA
        <br />
        Drag to rotate · scroll to zoom · right-drag to pan · click a part to select
      </div>
    </div>
  );
}
